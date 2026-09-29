# Persist Download Output Path Implementation Plan

**Goal:** Stop reconstructing downloaded file locations from task titles and persist the verified primary output path for every downloader.

**Architecture:** `Video.Name` remains the editable/display title. Core downloaders return a `DownloadResult` containing the verified primary output path, the queue forwards it to the API server, and the repository stores it in `video.outputPath` together with the success status. Legacy successful tasks without a stored path are reconciled lazily from task logs and conservative directory matching.

**Tech Stack:** Go, GORM/SQLite, Vitest/TypeScript contract types.

---

### Task 1: Define and test the download result contract

**Files:**

- Modify: `apps/core/internal/core/types.go`
- Modify: `apps/core/internal/core/queue.go`
- Test: `apps/core/internal/core/queue_test.go`
- Test: `apps/core/internal/api/server/download_identity_test.go`
- Test: `apps/core/internal/service/download_task_test.go`

1. Add `DownloadResult` with a verified absolute `PrimaryPath`.
2. Change `Downloader.Download` to return `(DownloadResult, error)`.
3. Forward the result through `TaskQueue.OnSuccess` and retain it in `TaskInfo`.
4. Update downloader test doubles and verify the success callback receives the exact result.

### Task 2: Resolve real output files for every downloader

**Files:**

- Modify: `apps/core/internal/core/downloader.go`
- Modify: `apps/core/internal/core/schema/loader.go`
- Test: `apps/core/internal/core/downloader_test.go`
- Test: `apps/core/internal/core/downloader_contract_test.go`

1. Snapshot matching output files before every download, not only M3U8.
2. Make yt-dlp use `<safe title>.%(ext)s` and print an `after_move` output marker.
3. Parse the marker safely and prefer that exact path when it exists.
4. Fall back to deterministic before/after directory reconciliation for BBDown, M3U8, direct, and MediaGo.
5. Accept non-empty extensionless legacy-style media output, reject temporary `.part`/`.ytdl` files, and return an error when no final output exists.

### Task 3: Persist output identity atomically with completion

**Files:**

- Modify: `apps/core/internal/db/models.go`
- Modify: `apps/core/internal/db/repo/video_repo.go`
- Modify: `apps/core/internal/api/server/queue_callbacks.go`
- Modify: `apps/core/internal/service/download_task.go`
- Test: `apps/core/internal/service/download_task_test.go`
- Test: `apps/core/internal/api/server/download_identity_test.go`

1. Add the default-empty `video.outputPath` column with a safe SQLite migration.
2. Clear stale output identity when a task starts again.
3. Persist `outputPath` and `status=success` in one repository update.
4. Broadcast success only after the result has been persisted.

### Task 4: Resolve current and historical files without title guessing

**Files:**

- Modify: `apps/core/internal/service/helpers.go`
- Modify: `apps/core/internal/service/download_task.go`
- Modify: `apps/core/internal/video/service.go`
- Test: `apps/core/internal/service/helpers_test.go`
- Test: `apps/core/internal/service/download_task_test.go`
- Test: `apps/core/internal/video/service_test.go`

1. Prefer a stored and validated `outputPath` for list, detail, and playback APIs.
2. Replace glob-based title lookup with literal filesystem matching.
3. Recognize exact extensionless files, standard media extensions, downloader suffix variants, and supported output directories.
4. For legacy successful tasks, recover a matching existing path from the task log or the configured task directory, then backfill `outputPath`.
5. Never mutate or silently rename a historical file during a read operation.

### Task 5: Publish the new field through shared contracts

**Files:**

- Modify: `packages/shared/common/src/types/index.ts`
- Update relevant API and UI tests if required.

1. Add optional `outputPath` to the download task contract.
2. Preserve the existing `file` and `exists` response fields for UI compatibility.

### Task 6: Verification

1. Run focused Go tests for core downloader, queue, service, server callbacks, database migration, and video playback.
2. Run `go test ./...` in `apps/core`.
3. Run `pnpm test:ts`, `pnpm type:check`, `pnpm lint`, and `pnpm format:check`.
4. Start Core against a temporary database/log copy, verify the two historical TikTok/Douyin tasks are recognized, and use the downloader contract test to confirm new yt-dlp output includes the real extension.

No staging, commit, or push is performed unless explicitly requested.
