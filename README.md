<div align="center">
  <h1>VidFetch</h1>
  <p><strong>带内置嗅探的跨平台视频下载器 · 支持登录会话自动获取</strong></p>
  <p>A cross-platform video downloader with built-in stream sniffing and automatic login-session (cookie) capture.</p>
  <br>
  <a href="./README.zh.md">上游中文说明</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/mediago-dev/mediago">Based on MediaGo</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="./LICENSE">MIT License</a>
  <hr />
</div>

## 这是什么

VidFetch 是一个跨平台视频下载工具：把内置浏览器指向任意页面，自动嗅探其中的视频流，选中即可下载——无需抓包、无需手动配置命令行工具。

本项目在 [MediaGo](https://github.com/mediago-dev/mediago)（MIT 许可）基础上二次开发，**新增了「VIP Cookie 自动获取」能力**：当你在内置浏览器里登录自己的账号后，VidFetch 会自动把该站点的登录会话附加到下载任务，用于保存**你自己有权观看**的内容。

> VidFetch is built on top of [MediaGo](https://github.com/mediago-dev/mediago) (MIT). Its headline addition is **automatic login-session capture**: sign in to a site inside the built-in browser and VidFetch attaches that site's cookies to the download, so you can save content **your own account is entitled to watch**.

## ✨ 核心特性

### 🔑 VIP Cookie 自动获取（本项目新增）
- 在内置浏览器登录任意站点后，下载时**自动按当前页面域名**附加你的登录 Cookie——不再局限于固定的几个白名单平台。
- **只读你自己浏览器里的会话**，不破解、不绕过 DRM。
- **默认不持久化**：Cookie 只存在于内存中，程序关闭即消失，绝不写入数据库。
- 内置**敏感域名黑名单**（邮箱、银行、支付、代码托管等），避免误抓无关登录态。

### 🌐 内置嗅探 + 浏览器扩展
指向页面即自动检测视频资源；也提供 Chrome / Edge 扩展，在任意站点一键发送到 VidFetch。

### 🎬 YouTube 及 1000+ 站点
底层由 yt-dlp 驱动，支持 YouTube、Twitter/X、Bilibili、小红书、抖音、TikTok 等上千个站点。

### 🎞️ 下载引擎编排 + 格式转换
统一编排 yt-dlp、N_m3u8DL-RE、BBDown、aria2、ffmpeg，支持 m3u8 合并、直播流录制、下载后直接转换格式与清晰度。

### 🐳 多种部署形态
桌面客户端（Electron）、局域网 Web UI、Docker 一键部署（amd64 / arm64），并对外暴露完整 HTTP API。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS 4、Radix UI / shadcn、zustand |
| 桌面 | Electron（WebContentsView 内置浏览器）、inversify DI |
| 后端 | Go 1.25、Gin、GORM + SQLite、SSE、MCP Server |
| 工程 | pnpm workspace + Turborepo + go.work、Task、vitest、Playwright |

## 🚀 从源码开发

前置：Node 24、pnpm、Go 1.25、[Task](https://taskfile.dev/) v3.51.1+。

```bash
git clone https://github.com/HongMengSeng/VidFetch.git
cd VidFetch
task setup        # 安装 Node 工作区 + 下载运行时工具（ffmpeg / yt-dlp / BBDown 等）
task dev:all      # 桌面 + Web 统一开发模式
```

- `task dev:web` 仅 Web，`task dev:electron` 仅桌面。
- 提交前请运行 `task check` 与 `task test`。
- `task` 是唯一公共入口；Turbo、pnpm `:raw` 脚本、`packages/tooling` 均为其内部实现细节。

## 🔑 Cookie 自动获取：工作原理

```
内置浏览器登录 VIP 账号 (WebContentsView, persist:webview)
   → session.cookies.get({ url: 当前页面域名 })
   → 自动合并进下载任务的 "Cookie:" 请求头
   → BBDown --cookie / yt-dlp 临时 cookies.txt / N_m3u8DL-RE --header
```

- 采集逻辑：`apps/electron/src/services/browser-tab-manager.service.ts`
- 已知平台（B 站 / 小红书 / YouTube 系）保留其规范登录域名；其余站点回退到「当前页面 origin」。
- 敏感域名黑名单在同一文件的 `SESSION_COOKIE_BLOCKLIST` 中维护，可按需增补。
- Cookie 仅存于内存 `RuntimeHeaders`，落库前由 Core 自动脱敏，不写入数据库。

## ⚖️ 使用边界与合规

- VidFetch 仅用于下载**你本人拥有合法访问权限**的内容（例如你自己付费的 VIP 账号）。
- 工具**不进行任何 DRM 解密**；受 Widevine / FairPlay 保护的加密流无法下载，这是设计边界而非缺陷。
- Cookie 属于敏感凭据：本项目默认不落盘，也请勿将含 Cookie 的内容分享或提交到版本库。

> **本项目仅供学习与研究使用，请勿用于任何商业或非法用途。**
>
> 1. 所有代码与功能仅作为学习流媒体技术的参考，使用者须遵守所在司法辖区的法律法规。
> 2. 通过本项目下载的内容版权归原作者/平台所有，请在 24 小时内删除或取得合法授权。
> 3. 开发者不对使用者的任何行为负责，包括但不限于下载受版权保护的内容或影响第三方平台。
> 4. 严禁将本项目用于大规模爬取、破坏平台服务或任何侵犯他人合法权益的活动。
> 5. 使用本项目即表示你已阅读并同意本免责声明；如不同意，请立即停止使用并删除。

## 📄 致谢与许可

- 本项目基于 **[MediaGo](https://github.com/mediago-dev/mediago)**（Copyright (c) 2023 士子☀️）二次开发，遵循 **MIT License**。原始版权与许可声明见 [LICENSE](./LICENSE)。
- 第三方运行时工具（yt-dlp、N_m3u8DL-RE、BBDown、aria2、ffmpeg 等）的许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
- VidFetch 的改动部分同样以 MIT 许可分发。

从源码构建详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
