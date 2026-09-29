# Browser Compatibility and X/yt-dlp Implementation Plan

**Goal:** Make MediaGo's existing Electron browser reliably load X and Google, then download X/Twitter status videos through the existing `youtube`/yt-dlp channel without adding a new download type.

**Architecture:** Keep Electron's bundled Chromium and the existing `persist:webview` profile. Repair browser-session configuration in the Electron main process, extend the shared page matcher and browser page adapter for X status URLs, and inject session cookies only for user-initiated downloads from the current tab. Preserve the public wire value `youtube` for compatibility while treating it internally as the yt-dlp execution channel.

**Tech Stack:** Electron 43 `WebContentsView`, TypeScript, React, shared browser-extension adapters, Go core, yt-dlp, Vitest, Go tests.

---

### Task 1: Browser compatibility baseline

**Files:**

- Modify: `apps/electron/src/constants/index.ts`
- Modify: `apps/electron/src/services/browser-tab-manager.service.ts`
- Test: `apps/electron/src/services/browser-tab-manager.service.test.ts`

1. Add failing tests for native desktop UA, system proxy restoration, HTTPS URL normalization, and popup routing.
2. Run the focused Electron service tests and confirm the new expectations fail.
3. Stop setting an empty desktop UA; only override the UA in mobile mode.
4. Restore `mode: "system"` when MediaGo's manual proxy is disabled.
5. Normalize schemeless navigation to HTTPS.
6. Preserve authentication popup behavior where an opener is required, with external-browser fallback for Google OAuth.
7. Run focused Electron tests.

### Task 2: X/Twitter status recognition

**Files:**

- Modify: `packages/shared/common/src/sniff/filter-rules.ts`
- Test: `packages/shared/common/tests/browser-contracts.test.ts`
- Modify: `packages/shared/common/src/utils/share-intent.ts`
- Test: `packages/shared/common/src/utils/share-intent.test.ts`

1. Add failing cases for `x.com/<user>/status/<id>` and `twitter.com/<user>/status/<id>`.
2. Map status URLs to the existing `DownloadType.youtube` yt-dlp channel.
3. Ensure X home/search URLs do not produce page-level download candidates.
4. Run the shared-common tests.

### Task 3: X page download actions

**Files:**

- Create: `packages/browser-extension/src/site-adapters/twitter.ts`
- Create: `packages/browser-extension/src/site-adapters/twitter-match.ts`
- Create: `packages/browser-extension/src/site-adapters/twitter.test.ts`
- Modify: `packages/browser-extension/src/site-adapters/registry.ts`
- Modify: `packages/browser-extension/src/site-adapters/index.ts`
- Modify: `packages/browser-extension/src/site-adapters/adapter-matches.ts`
- Modify: browser-extension and MediaGo extension registration/manifest tests as required

1. Add adapter tests for X/Twitter matching, status-link extraction, title extraction, dynamic timelines, and duplicate-button prevention.
2. Implement the adapter using stable semantic selectors and canonical status URLs.
3. Register X/Twitter hosts in the extension manifests.
4. Run browser-extension and MediaGo-extension tests.

### Task 4: Session cookies and yt-dlp presentation

**Files:**

- Modify: `apps/electron/src/services/browser-tab-manager.service.ts`
- Modify: `apps/electron/src/services/sniffing-helper.service.ts`
- Modify: `apps/ui/src/components/download-form-fields.tsx`
- Modify: shared i18n resources
- Test: relevant Electron/UI tests

1. Generalize the existing Bilibili-only cookie enrichment helper without exposing Cookie headers in snapshots, API payloads, MCP results, or logs.
2. Attach X cookies only to explicit, user-surface downloads using the current persistent partition.
3. Keep Agent discovery sessionless by default and require its existing explicit session-cookie option.
4. Rename user-visible `YouTube (yt-dlp)` wording to `yt-dlp (YouTube / X)` while preserving the wire value `youtube`.
5. Run focused tests.

### Task 5: API/MCP/CLI compatibility and verification

**Files:**

- Modify only help/schema text that incorrectly says the yt-dlp channel accepts YouTube URLs exclusively.
- Test: `apps/core/internal/core/downloader_contract_test.go`
- Test: API/MCP/CLI contract suites and existing integration tests

1. Add a downloader contract case proving an X status URL is passed once to yt-dlp with normal progress parsing.
2. Keep API/MCP/CLI download-type enums unchanged.
3. Add URL inference cases where those surfaces already infer type from a URL.
4. Run formatting, focused TypeScript tests, type checks, focused Go tests, and relevant integration tests.
5. Start the development app and visually verify X page loading, Google fallback behavior, injected download buttons, and a public X download with progress/speed.

### Acceptance Criteria

- Desktop browsing uses Chromium's native UA and the system proxy unless the user enables MediaGo's manual proxy.
- `x.com` and Google pages load over HTTPS; direct X login persists in `persist:webview`.
- Google OAuth is not bypassed through UA spoofing and falls back safely when embedded authentication is rejected.
- X/Twitter status URLs are downloaded by the existing yt-dlp channel without a new `twitter` type.
- Public downloads show progress and speed; authenticated downloads use current-tab cookies only when explicitly requested.
- Cookie values never appear in persisted snapshots, Agent results, API/MCP responses, or logs.
