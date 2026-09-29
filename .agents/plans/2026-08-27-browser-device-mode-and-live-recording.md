# 浏览器设备模式与直播录制可靠性实施计划

> **实施要求：** 按任务顺序推进，每个阶段先补回归测试，再修改实现；每个阶段通过对应测试后再进入下一阶段。

**目标：** 修复内置浏览器切换手机/电脑模式后页面无变化的问题，将工具栏改为单一手机图标的开关交互；同时恢复直播资源标签，并确保用户“结束录制”时已录制文件能够可靠收尾、校验和入库。

**范围：** Electron 内置浏览器、共享浏览器状态、下载队列/Core、下载列表 UI 与中英意文案。浏览器扩展不包含设备模拟能力，因此本次不改变扩展页面布局；直播状态与结束录制语义仍由共享下载任务接口统一提供给桌面端和扩展端。

## 已确认的问题

### 1. 设备模式只改了 User-Agent

当前 `tool-bar.tsx` 调用 `browser.setUserAgent(tabId, isMobile)`，Electron 端却忽略了 `tabId`，给所有标签页统一替换 UA。页面的视口尺寸、设备像素比、触摸能力和 `screen` 信息均未改变，也没有在切换完成后主动重新加载目标页面。

因此多数依赖 CSS media query、`window.innerWidth` 或首次请求服务端渲染结果的网站，即使刷新也仍会展示桌面布局。UI 又把模式保存在全局 `appStore.isMobile`，所以不同标签页之间还可能出现“图标状态”和实际页面状态不一致。

### 2. 直播判断存在，但状态在传递和持久化途中丢失

Core 的解析器会输出 `ProgressEvent.IsLive=true`，队列内存也会更新 `task.IsLive`，下载列表组件本身也保留了“直播”标签逻辑。缺口有两处：

- API 层没有注册 `queue.OnProgress` 来调用 `downloadService.SetIsLive`，数据库中的 `is_live` 仍为 false。
- UI 将进度写入 Zustand 时只保留了 `id/percent/speed`，没有把 `isLive` 合并到列表任务。

所以这不是标签被删除，而是直播信号没有抵达标签。

### 3. 当前停止逻辑无法安全结束直播录制

当前 `TaskQueue.Stop` 直接取消 context；PTY runner 在取消后马上关闭 PTY 并返回；Downloader 又在 runner 返回错误时直接退出，不扫描已经生成的文件。结果是直播停止时可能出现以下任一情况：

- 下载器还没来得及合并或关闭媒体容器；
- 已生成有效文件，但没有返回 `DownloadResult`，数据库也没有保存路径；
- UI 把直播操作显示为“暂停”，停止后又展示“继续下载”，与直播不可续传的语义冲突。

## 方案决策

### 设备模式

采用“每个标签页独立的真实设备模式”，而不是继续只切 UA：

- 设置页的 `isMobile` 仅作为新建标签页的默认值。
- 每个用户标签页快照保存自己的 `isMobile` 状态。
- 切换时同时应用移动 UA 和 Electron device emulation，并只重新加载当前标签页。
- 工具栏始终只显示 `Smartphone` 图标：未激活表示桌面模式，激活表示手机模式；再次点击恢复桌面模式。

不采用以下方案：

- **只补自动刷新：** 无法修复 viewport/media-query 网站。
- **继续全局切换所有标签页：** 用户在一个标签页操作会意外改变其他标签页，且与现有 IPC 中的 `tabId` 设计冲突。

### 直播结束

采用“温和终止 + 等待收尾 + 校验产物”的三段式结果：

- 用户结束正在录制的直播时，先向下载进程发送可收尾的中断，等待一个有上限的宽限期；超时才强制终止。
- 进程退出后无论是否返回 cancellation，都要扫描本次新增产物，并验证文件非空且路径属于任务输出目录。
- 有有效产物：调用现有 `OnSuccess`/`CompleteDownload`，任务状态为 `success`，保留“直播”标签和可播放文件。
- 没有产物：状态为 `stopped`，表示录制尚未形成文件。
- 存在产物但收尾或校验失败：状态为 `failed`，保留可诊断错误，不伪报成功。

继续使用现有 `success` 状态，避免为“已结束录制”新增数据库状态和迁移。日志和提示文案负责说明这是用户主动结束后保存的直播录像。

## 任务 1：建立每标签页设备模式状态契约

**修改文件：**

- `packages/shared/common/src/types/index.ts`
- `apps/ui/src/store/browser.ts`
- `apps/electron/src/services/browser-tab-manager.service.ts`
- `apps/electron/src/services/browser-tab-manager.service.test.ts`

**步骤：**

1. 在 `BrowserTabSnapshot` 增加必填的 `isMobile: boolean`。
2. 在 Electron 的 `TabRuntime` 中保存 `isMobile`；创建用户标签页时从 Core 配置 `isMobile` 读取默认值，内部/覆盖层标签页固定为桌面模式。
3. `snapshotForRuntime` 将运行时模式写入快照；UI 的快照规范化逻辑对旧快照使用 `false` 回退，避免热更新或旧状态导致崩溃。
4. 先写失败测试，覆盖：
   - 新建标签页继承设置中的默认模式；
   - 两个标签页可以分别保持手机和桌面模式；
   - 切换活动标签页后，快照中的模式与对应 runtime 一致；
   - 内部页面不接受设备模式切换。

**验收：** 工具栏后续只依赖活动标签页快照，不再用全局 `appStore.isMobile` 判断当前状态。

## 任务 2：实现真实的手机设备模拟与可靠刷新

**修改文件：**

- `packages/shared/common/src/types/index.ts`
- `packages/electron-preload/src/index.ts`
- `apps/electron/src/controller/webview.controller.ts`
- `apps/electron/src/controller/browser-tabs.controller.test.ts`
- `apps/electron/src/services/browser-tab-manager.service.ts`
- `apps/electron/src/services/browser-tab-manager.service.test.ts`
- `apps/electron/src/constants/index.ts`（若现有常量组织不适合，则在 browser tab manager 同目录新增专用常量模块）

**步骤：**

1. 将语义从 `setUserAgent` 提升为 `setDeviceMode(tabId, isMobile)`；preload/API 一次调用即代表完整模式切换。若需兼容旧渲染进程，旧 IPC 名称只作为临时别名转发，不再承载独立逻辑。
2. Controller 必须使用 payload 中的 `tabId`，只修改目标标签页；Core 配置仍更新为新标签页默认值，但不得遍历并覆盖其他已打开标签页。
3. 在 manager 中集中定义一套稳定的移动设备 profile，例如 412×915 CSS 像素和合适的 device scale factor。手机模式执行：
   - 设置移动 UA；
   - 调用 `webContents.enableDeviceEmulation(...)` 设置移动 viewport/screen；
   - 记录 runtime 的 `isMobile=true`；
   - 对当前 URL 执行 `reloadIgnoringCache()`，使服务端渲染和前端 media query 同时更新。
4. 桌面模式执行：
   - 恢复 runtime 创建时保存的桌面 UA；
   - 调用 `disableDeviceEmulation()`；
   - 记录 `isMobile=false`；
   - 仅重新加载目标标签页。
5. 模式应用成功后才发出新快照；应用或刷新失败时恢复旧 UA、旧 emulation 和旧快照，并把错误返回渲染进程。
6. 测试覆盖：UA、device emulation、目标 tab 隔离、reloadIgnoringCache、失败回滚、关闭/销毁中的 webContents 不抛未捕获异常。

**验收：** 使用依赖 `window.innerWidth`、CSS media query 和 UA 的测试页切换模式，无需用户再次手动刷新即可改变布局；其他标签页保持原模式。

## 任务 3：改造工具栏为单一手机图标开关

**修改文件：**

- `apps/ui/src/pages/source-extract/components/tool-bar.tsx`
- `apps/ui/src/pages/source-extract/components/tool-bar.test.tsx`（新增）
- `packages/shared/common/src/i18n/resources/zh.ts`
- `packages/shared/common/src/i18n/resources/en.ts`
- `packages/shared/common/src/i18n/resources/it.ts`
- `apps/ui/src/pages/setting-page/setting-sections.tsx`

**交互规范：**

- 始终渲染 `Smartphone`，不再渲染 `Monitor`。
- 桌面模式：ghost/muted 状态，`aria-pressed="false"`，提示“启用手机模式”。
- 手机模式：品牌色文字与浅色激活背景，`aria-pressed="true"`，提示“退出手机模式”。
- 点击已激活图标切回桌面模式。
- 切换期间按钮 disabled，并使用 `progress` 光标或轻量旋转状态，避免连续点击产生竞态。
- IPC 成功后以服务端返回/快照为准；失败时保留原状态并显示 toast，不做错误的乐观持久化。
- 默认模式设置项的说明改为“新标签页默认使用手机模式”，避免用户误以为会立即修改全部页面。

**测试覆盖：**

- 页面中只存在手机图标；
- 活动/非活动样式和 `aria-pressed` 正确；
- 点击调用当前 `tabId`；
- 等待期间不能重复触发；
- 失败时回滚并提示；
- 切换标签页后图标读取各自快照状态。

## 任务 4：补齐直播标记的实时传递和数据库持久化

**修改文件：**

- `apps/core/internal/api/server/queue_callbacks.go`
- `apps/core/internal/api/server/queue_callbacks_test.go`（新增）
- `apps/ui/src/hooks/use-download-events.ts`
- `apps/ui/src/hooks/use-download-events.test.ts`
- `apps/ui/src/store/download.ts`
- `apps/ui/src/store/download.test.ts`（新增或扩展现有测试）
- `apps/ui/src/hooks/use-tasks.ts`

**步骤：**

1. 在 `setupQueueCallbacks` 注册 `queue.OnProgress`。首次收到某任务 `IsLive=true` 时调用 `downloadService.SetIsLive(id, true)`，并确保同一任务后续进度不会造成高频重复写库。
2. 任务成功、失败、停止或删除时清理 API 层的直播持久化去重状态，避免任务 ID 复用或长期增长。
3. UI `DownloadEvent` 增加 `isLive`，`setEvents` 合并时使用“只升不降”语义：某次检测为 true 后，不能被后续缺省/false 进度覆盖。
4. `applyProgressToTaskCache` 同时合并 `status=downloading` 与 `isLive=true`；`useTasks` 也用实时事件覆盖数据库尚未完成刷新时的值。
5. 测试覆盖从 Core 进度事件到 UI 任务对象的完整链路，以及刷新列表后数据库仍保留直播标志。

**验收：** 直播解析日志出现后，当前列表无需等待任务结束即可显示“直播”标签；重启或重新进入下载列表后标签仍存在。

## 任务 5：为直播录制增加可收尾的终止协议

**修改文件：**

- `apps/core/internal/core/types.go`
- `apps/core/internal/core/queue.go`
- `apps/core/internal/core/queue_test.go`
- `apps/core/internal/core/downloader.go`
- `apps/core/internal/core/downloader_test.go`
- `apps/core/internal/core/runner/pty.go`
- `apps/core/internal/core/runner/pty_unix.go`
- `apps/core/internal/core/runner/pty_windows.go`
- `apps/core/internal/core/runner/exec.go`
- runner 对应测试文件（按平台 build tag 分开）

**协议设计：**

1. 在 Runner 调用契约中增加取消策略。普通下载保持立即取消；已检测为直播的 M3U8 使用 graceful 策略。策略必须能在 context 被取消的瞬间读取最新的 `liveDetected`，不能只在启动命令前判断。
2. graceful 取消按平台向前台下载进程发送可处理的中断（PTY/进程组），继续读取输出并等待固定宽限期；宽限期结束后再强制终止。具体信号封装在 runner 层，Downloader 不写平台判断。
3. Downloader 在“用户取消 + 已检测直播”的分支中不立即返回。先清理进度 tracker，再扫描本次运行新增/上报的媒体产物，并返回一个明确的终止结果：
   - `Finalized=true` 且有有效 artifacts；
   - `Finalized=false` 且没有 artifacts；
   - 收尾/校验错误。
4. 不以“目录里碰巧已有同名旧文件”作为成功依据。继续使用下载前后快照、下载器上报路径和输出目录边界校验，保证只认领本次任务产物。
5. Queue 根据结果分流：
   - 直播手动结束且有有效产物：更新内存为 `success/100%`，调用 `OnSuccess`，由现有 `CompleteDownload` 原子保存主文件和全部附件路径；
   - 直播手动结束但无产物：调用 `OnStopped`；
   - 收尾失败：调用 `OnFailed`；
   - 普通下载 cancellation：保持原有 stopped 行为；
   - 被删除任务：仍优先走 `discarded` 分支，不允许延迟到达的收尾结果重新写回数据库。
6. 日志分别记录“用户请求结束录制”“正在收尾”“录制已保存”“未产生媒体文件”“收尾失败”，便于排障。

**核心测试矩阵：**

- 直播自然结束 → success + 文件路径入库；
- 直播手动结束，有一个或多个有效产物 → success + `PrimaryPath/ArtifactPaths` 入库；
- 直播手动结束，零字节或无产物 → stopped；
- graceful 超时后强杀且媒体无效 → failed；
- 普通下载停止 → 仍为 stopped，不误报 success；
- pending 任务停止 → 仍为 stopped；
- 活跃直播被删除 → 不触发 success/stopped 持久化；
- Unix 与 Windows runner 都保证宽限期有上限，不留下子进程。

## 任务 6：提供符合直播语义的“结束录制”交互

**修改文件：**

- `apps/ui/src/pages/home-page/components/download-item.tsx`
- `apps/ui/src/pages/home-page/components/download-item.test.tsx`（新增）
- `apps/ui/src/pages/home-page/components/task-actions-menu.tsx`
- `apps/ui/src/pages/home-page/components/task-actions-menu.test.tsx`（新增或扩展）
- `packages/shared/common/src/i18n/resources/zh.ts`
- `packages/shared/common/src/i18n/resources/en.ts`
- `packages/shared/common/src/i18n/resources/it.ts`

**交互规范：**

- 普通下载继续显示“暂停”及当前图标，行为不变。
- `task.isLive && status=downloading` 时改用 Square/Stop 图标和“结束录制”。
- 点击后弹出确认：说明“已录制内容将收尾并保留，不能从当前时间点继续”。主操作为“结束并保存”，次操作为“继续录制”。
- 确认后当前条目显示“正在结束录制”，停止按钮禁用，避免重复请求；直到收到 success/stopped/failed 事件后解除。
- 有效录像最终显示“直播”+“下载成功”，可直接播放；无产物时显示“已停止”；失败时沿用失败原因入口。
- 下拉“更多”菜单与行尾快捷按钮使用相同动作和文案，不能一个显示暂停、另一个显示结束录制。
- 对已成功结束的直播不显示“继续下载”；重新录制只能按重新下载创建一次新任务。

**测试覆盖：** 直播与普通下载两套按钮、确认/取消、重复点击保护、三种终态，以及键盘操作和 accessible name。

## 任务 7：联调、回归与验收

**自动检查：**

```bash
pnpm exec vitest run apps/electron/src/services/browser-tab-manager.service.test.ts
pnpm exec vitest run apps/electron/src/controller/browser-tabs.controller.test.ts
pnpm exec vitest run apps/ui/src/hooks/use-download-events.test.ts
pnpm exec vitest run apps/ui/src/store/download.test.ts
pnpm exec vitest run apps/ui/src/pages/source-extract/components/tool-bar.test.tsx
pnpm exec vitest run apps/ui/src/pages/home-page/components/download-item.test.tsx
pnpm exec vitest run apps/ui/src/pages/home-page/components/task-actions-menu.test.tsx
cd apps/core && go test ./internal/core/... ./internal/api/server/...
pnpm types
pnpm lint
pnpm test
```

**手工验收：**

1. 打开两个标签页，A 切手机模式、B 保持桌面模式；切换标签和刷新后状态都不串。
2. 在响应式测试页验证 `innerWidth`、media query、UA 和页面布局都随模式切换。
3. 关闭并重新打开应用：设置项只影响新建标签页，已有会话恢复时使用各自快照策略。
4. 下载一个可持续几分钟的直播：检测后立即出现直播标签。
5. 录制一段时间后点击“结束录制”，确认期间显示收尾状态，结束后文件可播放、数据库路径正确、重启应用后仍可找到。
6. 在录制刚开始尚无分片时结束，验证不会生成伪成功记录。
7. 对普通 M3U8、YouTube/Bilibili、直接下载执行停止，确认原有暂停/继续语义未回归。
8. Windows 和 macOS 各进行一次真实直播停止测试，重点检查容器尾部、音视频时长和残留子进程。

## 完成标准

- 手机按钮单图标交互清晰，模式状态按标签页隔离，切换后页面真实响应且无需二次刷新。
- 直播标签在下载中实时出现并持久保存。
- 手动结束直播时，有效录像一定能被任务和数据库找到；无效/缺失产物不会被标记成功。
- 普通下载停止、任务删除、多文件产物与现有下载流程不受影响。
- 全量类型、lint、Go/TS 单测通过，并完成 macOS/Windows 的直播收尾冒烟测试。
