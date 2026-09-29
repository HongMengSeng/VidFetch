# Xiaohongshu Downloads Implementation Plan

**Goal:** Add Xiaohongshu video discovery and downloads to the embedded browser and browser extension by reusing MediaGo's existing yt-dlp integration and preserving every produced video artifact.

**Architecture:** A shared Xiaohongshu page adapter identifies canonical note URLs and injects the existing MediaGo action on detail media and list cards. Both browser surfaces submit a dedicated `xiaohongshu` source type to Go Core, which maps it to the already bundled yt-dlp executable and its existing argument/output contract. Core snapshots task output, returns all new video artifacts, persists them in a child table, and retains one primary path for existing playback UI compatibility.

**Tech Stack:** TypeScript, Vitest, Electron, Manifest V3, Go, GORM/SQLite, yt-dlp.

**Scope:** Individual Xiaohongshu video notes on `xiaohongshu.com` plus `xhslink.com` share URLs. Image/gallery/LivePhoto notes, account/collection batch downloads, and automated scrolling remain out of scope. All supported desktop platforms reuse the same pinned yt-dlp dependency already shipped by MediaGo.

---

### Task 1: Canonical URL and source contracts

**Files:**

- Modify: `packages/shared/common/src/types/index.ts`
- Modify: `packages/shared/common/src/sniff/filter-rules.ts`
- Modify: `packages/shared/common/src/sniff/filter-rules.test.ts`
- Modify: `packages/shared/common/src/utils/share-intent.ts`
- Modify: `packages/core-sdk/src/types.ts`
- Modify: `apps/core/internal/core/types.go`
- Modify: `apps/core/internal/core/types_test.go`

1. Add a dedicated `xiaohongshu` download type across TypeScript and Go contracts.
2. Accept `/explore/<id>`, `/discovery/item/<id>`, `/user/profile/<author>/<id>`, and `xhslink.com/<code>` while rejecting feeds, profiles, search, and live pages.
3. Preserve the complete work URL, including `xsec_token` and `xsec_source`.
4. Suppress generic MP4/M3U8 detections on Xiaohongshu pages so one note does not create rendition duplicates.
5. Verify URL inference, share intents, source validation, and existing site behavior.

### Task 2: Shared detail and list adapter

**Files:**

- Create: `packages/browser-extension/src/site-adapters/xiaohongshu-match.ts`
- Create: `packages/browser-extension/src/site-adapters/xiaohongshu.ts`
- Create: `packages/browser-extension/src/site-adapters/xiaohongshu.test.ts`
- Modify: `packages/browser-extension/src/site-adapters/registry.ts`
- Modify: `packages/browser-extension/src/site-adapters/index.ts`
- Modify: `packages/browser-extension/src/site-adapters/adapter-matches.ts`

1. Add DOM fixtures for list cards, detail pages, modal details, dynamic insertion, recycled cards, ads, and invalid links.
2. Resolve notes from semantic work anchors and active page URLs without stripping security query parameters.
3. Mount the existing Shadow DOM download action on the nearest image/video surface.
4. Key processed state by canonical note URL so virtualized list-card reuse refreshes the action correctly.
5. Extract compact visible titles and emit `DownloadType.xiaohongshu`.

### Task 3: Electron and extension integration

**Files:**

- Modify: `packages/mediago-extension/manifest.config.ts`
- Modify: extension manifest, page-action, and content-controller tests
- Modify: `apps/electron/src/services/sniffing-helper.service.ts`
- Modify: `apps/electron/src/services/browser-tab-manager.service.ts`
- Modify: related Electron tests

1. Inject the shared adapter on Xiaohongshu hosts in the browser extension.
2. Validate card candidates and current-page actions through the shared page URL filter.
3. Treat Xiaohongshu as a cookie-backed source in the embedded browser and attach only the current Xiaohongshu session cookies to explicit downloads.
4. Keep credentials ephemeral and excluded from persisted task headers and logs.

### Task 4: Reuse the existing yt-dlp runtime

**Files:**

- Modify: `apps/core/internal/core/types.go`
- Modify: `apps/core/internal/core/schema/loader.go`
- Modify: downloader contract tests

1. Map the dedicated `xiaohongshu` business type to the existing `yt-dlp` executable.
2. Reuse yt-dlp's URL, output template, header, proxy, progress, and final-path marker contract.
3. Preserve the full signed note URL and pass the current browser Cookie as an ephemeral HTTP header.
4. Keep runtime provisioning and packaging unchanged; no Xiaohongshu-specific binary is added.

### Task 5: Core downloader contract and execution

**Files:**

- Modify: `apps/core/internal/core/types.go`
- Modify: `apps/core/internal/core/schema/loader.go`
- Modify: `apps/core/internal/core/downloader.go`
- Modify: downloader contract and behavior tests

1. Resolve the yt-dlp-reported final output path after post-processing.
2. Build non-interactive CLI arguments with the full URL, stable output template, optional Cookie header, and proxy.
3. Snapshot supported media files before and after execution.
4. Return deterministic `PrimaryPath` and complete `ArtifactPaths`; fail when the process exits without a new artifact.
5. Keep existing downloader argument and progress contracts unchanged.

### Task 6: Persist and resolve every artifact

**Files:**

- Modify: `apps/core/internal/db/models.go`
- Modify: `apps/core/internal/db/db.go`
- Modify: `apps/core/internal/db/repo/video_repo.go`
- Modify: `apps/core/internal/service/download_task.go`
- Modify: queue callback and API tests
- Modify: shared task response types

1. Add a `download_artifact` child table keyed by task and normalized absolute path.
2. Clear stale artifact rows before retries and persist new artifacts transactionally with success status and primary output path.
3. Return all existing artifact paths as `files`, retaining `file` as the primary compatibility field.
4. Reconcile historical tasks from their primary output and conservative legacy discovery without renaming files.
5. Verify multi-P Bilibili and every yt-dlp-reported output remain discoverable after restart.

### Task 7: Labels and verification

**Files:**

- Modify: source-type labels, download-form choices, and translations as required
- Modify: focused UI tests

1. Display `小红书` / `Xiaohongshu` for the dedicated source type.
2. Run focused browser-adapter, extension, shared, Electron, tooling, and UI tests.
3. Run `go test ./...`, relevant TypeScript type checks, formatting, and `git diff --check`.
4. Verify the existing managed yt-dlp binary and runtime dependency contract remain unchanged.
5. Perform live embedded-browser verification when an accessible Xiaohongshu note is available; keep site-side login/risk-control failures separate from application regressions.

### Acceptance Criteria

- Detail media and list cards expose one MediaGo download action in both browser surfaces.
- Candidate URLs preserve the current work token and dispatch as `xiaohongshu`.
- Raw CDN requests do not flood discovery results.
- Embedded-browser downloads can use the current Xiaohongshu Cookie without persisting it.
- Packaged builds reuse the existing yt-dlp binary and contain no Xiaohongshu-specific runtime.
- Every produced video path is stored and returned; the primary path remains playable through existing UI actions.
- Existing Bilibili, YouTube, X/Twitter, TikTok, Douyin, direct, and M3U8 behavior remains covered.

No staging, commit, or push is performed unless explicitly requested.
