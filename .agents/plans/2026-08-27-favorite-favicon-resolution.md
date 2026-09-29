# Favorite Favicon Resolution Implementation Plan

**Goal:** Resolve missing favorite icons from each favorite's persisted original URL in Go Core, persist permanent versus retryable outcomes, and let the favorite page retry only transient failures once per entry.

**Architecture:** Core owns favicon discovery and persistence because it already owns favorites and URL metadata fetching. A resolver fetches the original page with bounded time and size, extracts declared icon links relative to the final page URL, falls back deterministically to `/favicon.ico`, validates the response, and returns a typed state. The renderer never invents an icon URL; it requests resolution by favorite ID and renders the Core result.

**Tech Stack:** Go 1.25, Gin, GORM/SQLite, React 19, SWR, TypeScript, Vitest.

---

### Task 1: Model the favicon state

**Files:**

- Modify: `apps/core/internal/db/models.go`
- Modify: `packages/shared/common/src/types/entities.ts`
- Modify: `apps/ui/src/types.d.ts`

1. Add `iconStatus` with `unresolved`, `ready`, `missing`, and `retryable` values.
2. Keep existing `icon` values backward compatible: rows with an icon normalize to `ready`; empty legacy rows normalize to `unresolved`.
3. Verify SQLite auto-migration and JSON contracts with unit tests.

### Task 2: Build the Core favicon resolver test-first

**Files:**

- Create: `apps/core/internal/service/favicon.go`
- Create: `apps/core/internal/service/favicon_test.go`

1. Add failing `httptest` cases for declared icons, relative URLs, `/favicon.ico` fallback, redirects, 404/410, invalid image payloads, timeout, 429, and 5xx.
2. Implement an injectable HTTP-client resolver with a five-second request timeout, redirect limits, bounded HTML/image reads, browser-like headers, HTTP(S)-only URL handling, and non-public-network blocking with scoped proxy/TUN compatibility.
3. Ensure every candidate is derived from the stored original page URL or metadata returned by that page.

### Task 3: Persist resolution through the favorites API

**Files:**

- Modify: `apps/core/internal/db/repo/favorite_repo.go`
- Modify: `apps/core/internal/service/favorite.go`
- Modify: `apps/core/internal/api/handler/favorite.go`
- Modify: `apps/core/internal/api/server/router.go`
- Create: `apps/core/internal/service/favorite_test.go`
- Add/update handler tests as needed.

1. Add repository lookup/update methods.
2. Add `ResolveFavoriteIcon(id)` that reads the URL from the stored favorite, skips `ready` and `missing`, invokes the resolver, and persists the result.
3. Add `POST /api/favorites/:id/icon/resolve`; the request accepts only the favorite ID, never an arbitrary icon URL.
4. Return the updated favorite in the normal API response envelope.

### Task 4: Retry eligible legacy rows once per favorite-page entry

**Files:**

- Modify: `apps/ui/src/api/favorite.ts`
- Modify: `apps/ui/src/hooks/use-favorites.ts`
- Modify: `apps/ui/src/pages/source-extract/components/favorite-list.tsx`
- Create: `apps/ui/src/pages/source-extract/components/favorite-list-logic.ts`
- Create: `apps/ui/src/pages/source-extract/components/favorite-list-logic.test.ts`

1. Add the resolve-icon API call and SWR mutation support.
2. Select only empty `unresolved` or `retryable` records.
3. Deduplicate IDs for the mounted favorite-page instance so React re-renders do not retry; remounting the page permits transient retries.
4. Render only the icon URL returned and persisted by Core.

### Task 5: Verify

1. Run targeted Go service/API tests.
2. Run targeted Vitest tests and UI TypeScript checking.
3. Run full Core tests, repository type checking, formatting, lint, and `git diff --check`.
4. Preserve all pre-existing staged work and leave the new changes unstaged unless explicitly asked to commit.
