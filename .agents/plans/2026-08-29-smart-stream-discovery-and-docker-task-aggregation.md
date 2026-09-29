# Smart Stream Discovery and Docker Task Aggregation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task with review checkpoints.

**Goal:** 首页提交流媒体 URL 时智能识别直接 HLS 或网页内的可下载资源，并让本地 Core 透明代理 Docker 任务，使本地与 Docker 下载能够在同一列表中可靠展示和操作。

**Architecture:** 首页先由本地 Core 对 URL 做内容探测；确认是 HLS 时直接进入下载确认，无法确认时调用现有 Electron 隐藏浏览器发现流程，失败后引导到标准素材提取页。所有 Docker 请求都由 UI 发给本地 Core，再由本地 Core 使用已配置的 Docker URL/API Key 原样转发；Docker Core 是远程任务唯一真实来源，本地数据库不创建镜像任务。UI 合并本地和 Docker 列表，并仅保存不含凭据的 Docker 展示快照，用于离线置灰。

**Tech Stack:** React 19、TypeScript、Zustand、SWR、Electron、Go/Gin、现有 Core SDK、Vitest、Go test、Playwright Electron E2E。

---

## 1. 已确认的产品规则

### 1.1 首页智能提交

- 仅在首页单条下载表单中，对“流媒体 + HTTP(S) URL”执行智能判断；批量提交不在首期范围。
- 用户点击“添加到列表”或“立即下载”后才开始探测，不增加单独的“检测”按钮。
- 提交意图必须贯穿全流程：
  - “添加到列表”最终使用 `startDownload: false`。
  - “立即下载”最终使用 `startDownload: true`。
- 本地文件以及可以按现有逻辑直接处理的输入保持原流程。
- URL 后缀只是快速提示，不是 HLS 的判断依据；没有 `.m3u8` 后缀的 HLS 必须能够识别。

### 1.2 智能判断顺序

1. 对 HTTP(S) URL 发起有界内容探测。
2. 跳过 BOM 和空行后，首个有效行是 `#EXTM3U`，则按 HLS 处理。
3. 内容不是 HLS、无法读取或返回 HTML 时，桌面端进入现有隐藏浏览器发现流程。
4. 隐藏浏览器同时按 URL 规则和响应 `Content-Type` 识别 HLS，支持没有扩展名的内部请求。
5. 找到资源后进入选择确认；没有资源、发生需要用户处理的跳转、登录/CAPTCHA/DRM 等情况时显示兜底弹窗。
6. 兜底弹窗右下角主按钮进入素材提取页，并打开用户最初输入的 URL，后续完全沿用素材提取标准流程。

内容探测建议限制：连接与总请求约 5 秒；非 HLS 读取小前缀后立即停止；确认 HLS 后可沿用 Inspector 的 2 MiB 上限解析 master playlist。重定向后的最终 URL 必须作为相对 variant URL 的解析基准。

### 1.3 资源选择与异常行为

- 只有一个资源时仍显示确认界面并默认选中；多个资源最多展示/提交 20 个。
- 优先展示 HLS master；同一 master 下可折叠 variants，避免重复创建任务。
- 用户填写的名称用于单资源；多资源时自动追加清晰度或序号，且允许编辑。
- 已存在的 URL 标记为不可选，不影响其他资源继续提交；不能因为一个重复项导致整批失败。
- 手动 headers 用于直接 HLS 探测和下载；浏览器发现资源使用实际捕获的请求 headers。
- 发现超时但已有部分资源时，展示结果并标记“结果可能不完整”；完全无结果才进入兜底。
- 取消、关闭弹窗或离开页面应终止发现任务并销毁隐藏页，不创建下载任务。
- 发现结果约 10 分钟失效；过期后保留原表单并提示重新检测。
- 普通重定向本身不是失败：只要最终发现资源就正常选择；重定向后仍无资源才进入兜底。
- Web/Docker 纯浏览器部署没有 Electron 隐藏页，只做直接 HLS 内容探测；失败时不能展示一个无法使用的素材提取按钮。

### 1.4 Docker 任务

- UI 不直接请求 Docker 地址；只请求本地 Core。
- 本地 Core 从现有配置读取 `dockerUrl` 和 `apiKey`，向 Docker Core 转发同一份表单任务数据（包括用户提供的 headers）以及 `startDownload`。
- 不设计额外的凭据托管、一次性令牌或本地任务镜像；本地 Core 只做受控 HTTP 代理。
- Docker Core 是 Docker 任务的真实来源；本地 Core 数据库不插入伪造的 Docker `Video` 记录。
- 下载列表同时展示 `local` 和 `docker` 来源，内部使用复合标识，例如 `local:123`、`docker:123`，避免数字 ID 冲突。
- Docker 卡片通过来源标签、容器图标、轻微色调/左侧标记与本地任务区分。
- Docker 离线时保留最后一次成功同步的任务并整体置灰，显示“Docker 离线”和最后同步时间，禁止启动、暂停、删除、编辑等写操作。
- 离线缓存不得保存 API Key、headers、日志或输出目录；只保存列表渲染需要的安全字段。

## 2. 状态机与数据流

首页表单状态：

```text
editing
  -> probing
     -> selecting (直接 HLS)
     -> discovering
        -> selecting (发现一个或多个资源)
        -> fallback (无资源/需交互/失败)
  -> creating
  -> editing (成功重置、失败保留输入)
```

Docker 数据流：

```text
UI 表单/任务操作
  -> 本地 Core /api/docker/*
     -> 读取本地 Docker 配置
     -> 原样转发请求体、查询参数和动作
        -> Docker Core /api/*（真实任务）

UI 列表
  -> 本地任务接口
  -> 本地 Core 的 Docker 代理接口
  -> 按 createdDate 合并、分页、渲染
  -> Docker 失败时读取安全快照并置灰
```

## 3. 关键架构决定

### ADR-1：以内容识别 HLS

后缀只能作为提示。直接探测响应内容的首个有效行，能够覆盖签名 URL、无扩展名 CDN 地址和查询参数路由；响应头与后缀冲突时，以内容为准。

### ADR-2：复用发现和素材提取能力

不再实现第二套浏览器嗅探。首页通过现有 discovery API 调用 Electron 隐藏 agent，资源分组、过滤、质量信息和 headers 均复用现有 SourceData 语义；失败后把原 URL 交给可见素材提取页。

### ADR-3：本地 Core 代理 Docker，但不拥有 Docker 任务

这样 UI 不需要处理跨域、Docker API Key 和两个服务地址，操作链路也保持一致。代理只转发并返回 Docker 响应，不把远程任务写入本地数据库，避免同步、冲突和双主问题。

## 4. 实施任务

### Task 1：建立智能提交与统一任务的纯类型模型

**Files:**

- Modify: `packages/common/src/types/index.ts`
- Create: `apps/ui/src/components/smart-stream-submit-logic.ts`
- Create: `apps/ui/src/components/smart-stream-submit-logic.test.ts`

**Steps:**

1. 先写测试，覆盖 `editing -> probing -> discovering/selecting -> creating`、取消、过期和失败回到原表单。
2. 为 UI 增加 `TaskOrigin = 'local' | 'docker'`、`TaskRef`、`UnifiedDownloadTask`；不要改变 Core 本地 `Video` 主键类型。
3. 将按钮意图定义为显式 `SubmissionIntent`，保存 `startDownload`，防止发现流程后丢失“添加/立即下载”的选择。
4. 把资源去重、最多 20 个、重复任务禁用、多资源命名做成纯函数并测试。
5. 运行 `pnpm test:ts -- apps/ui/src/components/smart-stream-submit-logic.test.ts`，确认通过。

### Task 2：让 HLS Inspector 支持无后缀 URL 和正确重定向基址

**Files:**

- Modify: `apps/core/internal/service/m3u8_inspector.go`
- Modify: `apps/core/internal/service/m3u8_inspector_test.go`
- Modify: `apps/core/internal/api/handler/source.go`
- Modify: `apps/core/internal/api/handler/source_test.go`

**Steps:**

1. 先用 `httptest.Server` 写失败测试：
   - `/signed/play?id=1` 返回 HLS，但 URL 无 `.m3u8`。
   - 首行有 BOM/空行后才出现 `#EXTM3U`。
   - HTML/JSON 不被误判为 HLS。
   - 重定向到另一目录后，相对 variant URL 按最终地址解析。
   - 响应体超过上限、超时、重定向过多时有稳定错误。
2. 去除 HTTP(S) inspect 对 `.m3u8` 后缀的硬限制。
3. 使用有界读取和上下文超时；非 HLS 判断完成后立即关闭响应体。
4. 使用 `response.Request.URL` 作为 playlist 的最终基址。
5. 保持错误分类可供 UI 区分“不是 HLS，可继续浏览器发现”和“输入无效”。
6. 运行 `cd apps/core && go test ./internal/service ./internal/api/handler`。

### Task 3：增强 Electron 隐藏发现对无后缀 HLS 和部分结果的支持

**Files:**

- Modify: `apps/electron/src/services/sniffing-helper.service.ts`
- Modify: `apps/electron/src/services/sniffing-helper.service.test.ts`
- Modify: `apps/electron/src/services/browser-tab-manager.service.ts`
- Modify: `apps/electron/src/services/discovery-executor.service.ts`
- Modify: `packages/common/src/sniff/filter-rules.ts`

**Steps:**

1. 先写测试：无后缀请求在响应 `Content-Type` 为 `application/vnd.apple.mpegurl`、`application/x-mpegURL` 或 `audio/mpegurl` 时被识别。
2. 在 Electron session 的响应头阶段关联 request ID 和响应类型；仍保留现有 URL/请求规则。
3. URL 后缀和响应类型冲突时，不直接认定内容；需要时交给 Core Inspector 复核。
4. 超时已有资源时返回 `{ sources, partial: true }`，而不是丢弃结果；完全无结果才返回失败。
5. 确保成功、取消、超时、页面关闭都会移除监听器并销毁 hidden view。
6. 运行相关 Vitest：`pnpm test:ts -- apps/electron/src/services/sniffing-helper.service.test.ts`。

### Task 4：实现首页提交时的探测编排和资源选择

**Files:**

- Create: `apps/ui/src/api/source-discovery.ts`
- Create: `apps/ui/src/hooks/use-smart-stream-submit.ts`
- Create: `apps/ui/src/hooks/use-smart-stream-submit.test.ts`
- Create: `apps/ui/src/components/discovered-source-picker.tsx`
- Create: `apps/ui/src/components/discovered-source-picker.test.tsx`
- Modify: `apps/ui/src/components/download-form.tsx`
- Modify: `apps/ui/src/components/download-form-fields.tsx`
- Modify: `apps/ui/src/components/global-download-form.tsx`

**Steps:**

1. 先写 hook 测试，覆盖直接 HLS、HTML 后隐藏发现、单资源确认、多资源选择、部分结果、取消和 intent 保留。
2. `use-smart-stream-submit` 首先调用本地 Core inspect；只有明确不是 HLS或无法确认时才启动 discovery browser job。
3. 轮询/订阅现有 discovery job 状态，离开或取消时调用取消接口。
4. 资源选择器复用素材提取现有来源分组、过滤和质量显示；一个资源时默认勾选但不跳过确认。
5. 选择完成后生成当前下载任务 DTO：
   - 本地目标调用当前本地创建接口。
   - Docker 目标调用新的本地 Core Docker 代理接口。
6. 对重复 URL 做逐项禁用并返回可理解的部分成功结果。
7. 全流程失败保留 URL、名称、headers、目标和提交意图，成功后按现有规则重置表单。
8. 运行新测试及现有 `download-form-logic.test.ts`。

### Task 5：实现素材提取兜底并打开原 URL

**Files:**

- Create: `apps/ui/src/store/source-extract-intent.ts`
- Create: `apps/ui/src/store/source-extract-intent.test.ts`
- Create: `apps/ui/src/components/stream-discovery-fallback-dialog.tsx`
- Modify: `apps/ui/src/pages/source-extract/components/browser-view-panel.tsx`
- Modify: `apps/ui/src/routes/app-routes.tsx`（仅在需要消费跳转 intent 时修改）
- Modify: `apps/ui/src/store/browser.ts`

**Steps:**

1. 先写测试，验证 fallback 保存原始 URL，且只能消费一次。
2. 弹窗说明未发现可下载资源；右下角主按钮文案为“打开素材提取”。
3. 桌面端按现有 `openInNewWindow` 设置进入 `/source` 或打开素材提取窗口，并立即创建/复用标签加载原 URL。
4. Web 构建隐藏不可执行的跳转按钮，只保留关闭和可操作说明。
5. 对登录、CAPTCHA、DRM、需交互页面使用同一兜底，不承诺自动绕过。
6. 运行相关 Zustand/组件测试。

### Task 6：在本地 Core 增加 Docker HTTP 代理

**Files:**

- Create: `apps/core/internal/docker/client.go`
- Create: `apps/core/internal/docker/client_test.go`
- Create: `apps/core/internal/api/handler/docker.go`
- Create: `apps/core/internal/api/handler/docker_test.go`
- Modify: `apps/core/internal/api/server/server.go`
- Modify: `apps/core/internal/api/server/router.go`
- Modify: `apps/core/internal/api/server/router_test.go`（若路由测试文件存在则扩展）

**Steps:**

1. 用假 Docker `httptest.Server` 先写失败测试，验证方法、path、query、JSON body、`X-API-Key` 和远端状态码/错误体被正确转发。
2. client 每次请求从当前 ConfigStore 读取 `EnableDocker`、`DockerUrl`、`ApiKey`，配置修改后无需重启。
3. 仅允许已解析的 HTTP(S) Docker base URL；规范化 path，禁止用户输入覆盖 host/scheme，避免开放代理。
4. 为列表、创建、更新、删除、启动、停止、进度/状态和日志提供明确的 `/api/docker/*` 路由；不要实现任意 path 的通配透传。
5. 创建接口将 UI 的 `{ tasks, startDownload }` JSON 原样转发给 Docker `/api/downloads`，不删除或另存任务 headers。
6. 设置合理连接/响应超时，客户端断开时取消上游请求；不要跟随到非 HTTP(S) scheme，也要防止 Docker URL 指向当前 Core 导致递归代理。
7. 不写入本地下载数据库，不在日志中打印 API Key、Authorization 或任务 headers。
8. 运行 `cd apps/core && go test ./internal/docker ./internal/api/handler ./internal/api/server`。

### Task 7：把 Docker 提交和操作切换到本地 Core

**Files:**

- Modify: `apps/ui/src/hooks/use-docker-api.ts`
- Modify: `apps/ui/src/hooks/use-docker-api.test.ts`
- Create: `apps/ui/src/api/docker-download-task.ts`
- Modify: `apps/ui/src/components/download-form.tsx`
- Modify: `apps/ui/src/pages/home-page/components/task-actions-menu.tsx`

**Steps:**

1. 修改现有测试，断言请求目标是相对路径 `/api/docker/...`，而不是 `${dockerUrl}/api/...`。
2. UI 不再读取 API Key 构建远程请求头；Docker URL/API Key 只用于配置界面和本地 Core。
3. 创建任务时保持当前表单 DTO 和 `startDownload` 不变；敏感登录 headers 跟随任务 body 直接交给本地 Core 转发。
4. 按 `TaskRef.origin` 将启动、暂停、删除、编辑和日志操作分派到本地或 Docker 代理接口。
5. Docker 请求失败不得误操作同数字 ID 的本地任务。
6. 运行 `pnpm test:ts -- apps/ui/src/hooks/use-docker-api.test.ts` 及动作菜单测试。

### Task 8：合并本地与 Docker 下载列表

**Files:**

- Modify: `apps/ui/src/hooks/use-tasks.ts`
- Create: `apps/ui/src/hooks/use-unified-tasks.ts`
- Create: `apps/ui/src/hooks/use-unified-tasks.test.ts`
- Modify: `apps/ui/src/pages/home-page/components/download-list.tsx`
- Modify: `apps/ui/src/pages/home-page/components/download-item.tsx`
- Modify: `apps/ui/src/pages/home-page/components/list-header.tsx`

**Steps:**

1. 先写合并测试：ID 冲突、时间排序、本地或 Docker 单边失败、刷新恢复、选择状态和分页。
2. 全局第 `p` 页请求两端前 `p * pageSize` 条，合并后按 `createdDate` 倒序并截取当前页，保证现有 offset API 下排序正确；后续数据量大时再设计游标聚合接口。
3. 为每项生成复合 key，不把 `docker:7` 与 `local:7` 视为同一项。
4. 本地进度继续使用当前 SSE；Docker 活跃任务通过本地代理短轮询（约 1 秒），空闲时退避到 10–15 秒，窗口不可见时暂停高频轮询。
5. Docker 项显示来源标签、容器图标、远程标记和轻量视觉差异；保持现有列表密度和交互语义。
6. 批量操作按来源分组调用，展示各来源成功/失败数量，不做跨来源事务承诺。
7. 运行统一列表和现有下载列表测试。

### Task 9：实现 Docker 离线快照、置灰与恢复

**Files:**

- Create: `apps/ui/src/store/docker-downloads.ts`
- Create: `apps/ui/src/store/docker-downloads.test.ts`
- Modify: `apps/ui/src/pages/home-page/components/download-item.tsx`
- Modify: `apps/ui/src/pages/home-page/components/task-actions-menu.tsx`
- Modify: `apps/ui/src/pages/home-page/components/list-header.tsx`

**Steps:**

1. 定义显式 `DockerTaskSnapshot` 白名单字段，只包括 id、名称、URL 的安全显示形式、状态、进度、大小、创建时间和最后同步时间。
2. 写测试确保序列化结果不含 `apiKey`、headers、日志、输出目录或任意 Authorization 字段。
3. 每次 Docker 列表成功后原子更新快照和 `lastSyncedAt`；失败时保留旧快照并设置 offline。
4. 离线项使用 `aria-disabled`/组件 disabled 状态与 `cursor: not-allowed`，不使用阻止禁用光标显示的 `pointer-events: none`。
5. 离线时禁用所有写操作，但保留查看基本详情；恢复后自动替换快照并解除置灰。
6. URL 如需缓存，至少去除 query/fragment；名称中可能包含敏感信息，提供清空缓存的配置联动。
7. 运行 store 和组件测试。

### Task 10：补充文案、集成测试和回归验证

**Files:**

- Modify: `packages/common/src/i18n/resources/zh.ts`
- Modify: `packages/common/src/i18n/resources/en.ts`
- Modify: `packages/common/src/i18n/resources/it.ts`
- Create: `tests/e2e/electron/smart-stream-submit.spec.ts`
- Modify: `tests/media-service/server.ts`
- Modify: `tests/media-service/server.test.ts`
- Modify: `tests/e2e/support/media.ts`
- Modify: `tests/e2e/electron/agent-discovery.spec.ts`
- Modify: relevant public user documentation under `docs/` only if the feature needs user-facing documentation

**Steps:**

1. 增加无后缀 HLS fixture、HTML 页面内无后缀 HLS 请求、完全无资源页面、重定向页面和慢响应。
2. E2E 覆盖：
   - 无后缀直接 HLS 被识别。
   - 网页进入隐藏发现并显示选择器。
   - 无资源弹窗进入素材提取并打开原 URL。
   - 取消发现后没有残留 hidden view 或下载任务。
3. Go handler 集成测试覆盖 Docker 创建 payload 原样转发、列表/动作代理、远端错误和递归代理拒绝。
4. UI 集成测试覆盖本地 + Docker 同 ID、Docker 离线置灰、恢复刷新及敏感字段不入缓存。
5. 添加中英意文案：探测中、发现中、结果不完整、未发现资源、打开素材提取、Docker 来源、Docker 离线、最后同步时间。
6. 如果修改 `docs/`，确认都是公开用户文档，并运行 `git status --short -- docs` 排查内部计划误入。
7. 依次运行：

   ```bash
   pnpm test:go
   pnpm test:ts
   pnpm type:check
   pnpm lint
   pnpm format:check
   pnpm test:e2e:build
   pnpm test:e2e:electron:raw -- tests/e2e/electron/smart-stream-submit.spec.ts
   ```

8. 手工验收本地和 Docker 两个目标的“添加到列表/立即下载”，以及带 Cookie/Referer headers 的任务能够被 Docker Core 收到并执行。

## 5. 验收标准

- 输入没有 `.m3u8` 后缀、但内容为 HLS 的 URL，提交后无需打开素材提取即可创建任务。
- 输入普通网页时，桌面端自动调用隐藏发现；找到资源后让用户选择，未找到时可一键进入素材提取并打开原 URL。
- `startDownload`、名称、headers 和目标 Core 在探测/选择过程中不丢失。
- Docker 表单数据通过本地 Core 原样到达 Docker Core，且本地数据库没有生成 Docker 镜像任务。
- 下载列表可同时显示和操作本地、Docker 任务，同数字 ID 不冲突。
- Docker 断线后最后任务仍显示但置灰，恢复连接后自动刷新；缓存中不存在 API Key、headers、日志和输出目录。
- 取消、超时、跳转和组件卸载不会遗留 discovery job、网络监听器或 hidden view。
- Go、TypeScript、类型检查、lint、格式和关键 Electron E2E 全部通过。

## 6. 明确不在首期范围

- 批量表单逐条智能嗅探。
- 自动绕过 DRM、CAPTCHA、登录或复杂用户交互。
- 本地 Core 持久化 Docker 任务副本或实现双向数据库同步。
- 为任务凭据实现额外的托管、加密信封或一次性令牌系统。
- 将 Docker SSE 直接桥接为本地 SSE；首期使用经本地 Core 的有限轮询。
