# TikTok and Douyin Downloads Implementation Plan

**Goal:** Add complete single-post TikTok and Douyin download support across pasted URLs, the embedded browser, the browser extension, session cookies, task titles, and source labels.

**Architecture:** Reuse the existing `youtube` wire value as MediaGo's yt-dlp execution channel. Add canonical URL contracts and one shared short-video page adapter for TikTok and Douyin, then enrich explicit browser downloads with cookies from the existing persistent webview partition. Keep raw media requests suppressed on supported feed pages so one user-facing post produces one stable task.

**Tech Stack:** TypeScript, Vitest, Electron 43, browser content scripts, React UI utilities, Go, yt-dlp.

**Scope:** TikTok single-post URLs, TikTok share links, Douyin single-video URLs, and Douyin share links. Profile/collection batch downloads and live streams remain out of scope. Slideshow output follows the bundled yt-dlp extractor's supported output.

---

### Task 1: Canonical URL Routing

**Files:**

- Modify: `packages/shared/common/src/sniff/filter-rules.ts`
- Modify: `packages/shared/common/src/sniff/filter-rules.test.ts`
- Modify: `packages/shared/common/src/utils/share-intent.ts`
- Modify: `packages/shared/common/src/utils/share-intent.test.ts`
- Modify: `apps/core/internal/core/types.go`
- Modify: `apps/core/internal/core/types_test.go`
- Modify: `apps/ui/src/utils/index.test.ts`

**Steps:**

1. Add failing cases for TikTok canonical video/share URLs, `vm.tiktok.com`, `vt.tiktok.com`, Douyin `/video/<id>`, and `v.douyin.com` share URLs.
2. Add rejection cases for TikTok/Douyin home, profile, search, collection, and live URLs.
3. Route accepted URLs to `DownloadType.youtube` / `TypeYoutube` without adding a new public enum.
4. Suppress request-level MP4/M3U8 noise on TikTok/Douyin pages while retaining page-level and adapter candidates.
5. Run `pnpm exec vitest run packages/shared/common/src/sniff/filter-rules.test.ts packages/shared/common/src/utils/share-intent.test.ts apps/ui/src/utils/index.test.ts` and `go test ./internal/core -run TestInferDownloadType` from `apps/core`.

### Task 2: TikTok and Douyin Page Adapter

**Files:**

- Create: `packages/browser-extension/src/site-adapters/short-video-match.ts`
- Create: `packages/browser-extension/src/site-adapters/short-video.ts`
- Create: `packages/browser-extension/src/site-adapters/short-video.test.ts`
- Modify: `packages/browser-extension/src/site-adapters/registry.ts`
- Modify: `packages/browser-extension/src/site-adapters/index.ts`
- Modify: `packages/browser-extension/src/site-adapters/adapter-matches.ts`

**Steps:**

1. Add failing DOM fixtures for TikTok feed cards, TikTok detail pages, Douyin feed cards, Douyin detail pages, dynamic insertion, duplicate prevention, invalid links, and promoted cards.
2. Match TikTok and Douyin hosts through a shared adapter but keep site-specific canonical URL parsers.
3. Resolve TikTok posts to `/@<handle>/video/<id>` and Douyin posts to `/video/<id>`, stripping query strings and fragments.
4. Prefer semantic `data-e2e`/post containers and canonical post anchors; use the nearest media surface as the button mount.
5. Extract the visible description as the candidate name and dispatch through `DownloadType.youtube`.
6. Run `pnpm exec vitest run packages/browser-extension/src/site-adapters/short-video.test.ts packages/browser-extension/src/site-adapters/twitter.test.ts`.

### Task 3: Browser Extension Wiring

**Files:**

- Modify: `packages/mediago-extension/manifest.config.ts`
- Modify: `packages/mediago-extension/src/manifest-config.test.ts`
- Modify: `packages/mediago-extension/src/content/page-action-controller.test.ts`
- Modify: `packages/mediago-extension/src/background/page-action.test.ts`
- Modify: `packages/browser-extension/test-dts/public-api.ts`

**Steps:**

1. Add TikTok and Douyin content-script matches and web-accessible-resource matches.
2. Extend public adapter-match type coverage.
3. Prove canonical page actions and per-card candidates pass background validation, while home/profile/live routes stay unsupported as page-level tasks.
4. Run the focused extension tests and public type tests.

### Task 4: Embedded Browser Cookies and Source Detection

**Files:**

- Modify: `apps/electron/src/services/browser-tab-manager.service.ts`
- Modify: `apps/electron/src/services/browser-tab-manager.service.test.ts`
- Modify: `apps/electron/src/services/sniffing-helper.service.ts`
- Modify: `apps/electron/src/services/sniffing-helper.service.test.ts`
- Modify: `apps/electron/src/constants/index.ts`

**Steps:**

1. Add failing tests showing explicit TikTok and Douyin downloads receive cookies from `https://www.tiktok.com` and `https://www.douyin.com`.
2. Keep unrelated yt-dlp URLs and automatic discovery sessionless.
3. Recognize TikTok/Douyin as cookie-backed yt-dlp sources and suppress their raw media rendition noise.
4. Normalize known site navigation to HTTPS.
5. Verify serialized task snapshots and logs never expose cookie values.

### Task 5: Stable Short-Video Titles

**Files:**

- Refactor: `apps/core/internal/service/x_title.go`
- Modify: `apps/core/internal/service/x_title_test.go`
- Create: `apps/core/internal/service/short_video_title.go`
- Create: `apps/core/internal/service/short_video_title_test.go`
- Modify: `apps/core/internal/service/download_task.go`

**Steps:**

1. Generalize the existing Unicode-aware excerpt, URL removal, byte limit, and ID suffix helpers without changing X behavior.
2. Add failing cases for `@handle · excerpt` on TikTok and `抖音 · excerpt` when Douyin has no handle in its canonical URL.
3. Add readable `TikTok video` / `抖音视频` fallbacks and an 180-byte filename cap.
4. Append the final eight digits of the post ID when normalized titles collide.
5. Cover both single and bulk task creation, then run `go test ./internal/service -run 'Title|DownloadTask'`.

### Task 6: Labels, Help Text, and Errors

**Files:**

- Modify: `apps/ui/src/pages/source-extract/components/source-type-label.ts`
- Modify: `apps/ui/src/pages/source-extract/components/source-type-label.test.ts`
- Modify: `packages/shared/common/src/i18n/resources/{zh,en,it}.ts`
- Modify: `apps/core/internal/api/handler/task.go`
- Modify: `apps/core/internal/mcpserver/server.go`
- Modify: relevant CLI/API inference tests

**Steps:**

1. Display `TikTok` and `抖音` for their yt-dlp-backed sources.
2. Update the selector label to `yt-dlp（YouTube / X / TikTok / 抖音）` and corresponding translations.
3. Update API/MCP help text without changing accepted enum values.
4. Add a yt-dlp contract fixture proving Douyin's fresh-cookie error is preserved as the visible failure reason.

### Task 7: Verification

**Steps:**

1. Run `pnpm exec vitest run` for all touched TypeScript suites.
2. Run `pnpm type:check`, `pnpm lint`, and `pnpm format:check`.
3. Run `go test ./...` and `go vet ./...` from `apps/core` with a writable temporary Go cache.
4. Run `git diff --check` and inspect `git status --short`.
5. Start the Electron development app and verify one public TikTok URL and one public Douyin URL when network/site access permits; record any extractor-side site restriction separately from application regressions.

### Acceptance Criteria

- Pasted canonical and share links infer the yt-dlp channel on UI, API, CLI, and MCP surfaces.
- Embedded TikTok/Douyin detail pages and feed cards expose one MediaGo action per post.
- Explicit browser downloads receive only the matching site's current session cookies.
- Raw media requests do not flood the discovery list for supported short-video pages.
- New tasks use compact, filesystem-safe titles with deterministic collision suffixes.
- Download lists distinguish TikTok and 抖音 while preserving the `youtube` wire value.
- Existing YouTube, X/Twitter, and Bilibili behavior remains covered and unchanged.
