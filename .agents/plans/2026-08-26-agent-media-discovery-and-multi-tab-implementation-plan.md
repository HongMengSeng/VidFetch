# Agent Media Discovery and Multi-Tab Source Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose MediaGo media discovery and HLS inspection through HTTP API, MCP, and CLI, while turning the Electron source-extraction surface into a true multi-tab browser that also executes Agent-triggered discovery jobs in hidden tabs.

**Architecture:** Core owns short-lived discovery jobs, public contracts, execution scheduling, redacted results, and download handoff. Electron registers as one authenticated browser executor, owns browser sessions and sensitive headers, and uses one `WebContentsView` per visible tab plus at most one serialized hidden Agent tab. API, MCP, CLI, SDK, and the desktop UI remain thin adapters over the same discovery service.

**Tech Stack:** Go 1.25, Gin, Model Context Protocol Go SDK, Cobra, TypeScript 7, React 19, Zustand, Electron 43 `WebContentsView`, Vitest, Playwright, pnpm/Turborepo.

---

## 1. Scope and validated constraints

### In scope

- `POST /api/discoveries` starts discovery for a page or media URL.
- Core inspects explicit HLS sources locally and delegates browser discovery to Electron.
- API, MCP, CLI, and `@mediago/core-sdk` expose the same normalized discovery model.
- Agent discovery is asynchronous internally; CLI and MCP may wait for a bounded period.
- Electron receives Core jobs through a dedicated authenticated bridge stream.
- The source-extraction page supports true multi-tab navigation with isolated source lists.
- Each visible tab owns a distinct `WebContentsView`; only the active tab is attached to the host window.
- Agent jobs run in a hidden tab and do not interrupt the active user tab.
- Session-derived `Cookie`, `Authorization`, and `Proxy-Authorization` values are never returned by public discovery APIs or written to logs.
- A discovery result can create and immediately start downloads without exposing its private headers.

### V1 constraints

- One Electron browser executor per Core process.
- One hidden Agent discovery executes at a time; additional jobs queue in Core.
- Visible user tabs have no application-level count limit; practical capacity is governed by available system resources.
- Tabs and discovery jobs are not restored after application restart.
- Discovery jobs and private credentials expire ten minutes after terminal completion.
- Public requests default to `useSessionCookies: false`; callers must opt in explicitly.
- No DRM bypass, CAPTCHA bypass, or access-control bypass.
- No database schema migration. Session credentials are process-memory-only and cannot survive Core restart.

### Out of scope

- A headless browser embedded directly in the Go Core or Docker image.
- Concurrent execution by multiple Electron instances.
- Cross-device transfer of Electron session cookies.
- Persisted browser sessions, browser history, or discovery history.
- Returning raw cookies or authorization headers to API/MCP/CLI callers.
- Replacing the existing browser extension protocol.

## 2. High-level design

```text
                         public control plane

  CLI ─────────────┐
  MCP ─────────────┼──▶ Core DiscoveryService ───▶ redacted DiscoveryJob
  HTTP / SDK ──────┘             │                         │
                                 │                         ├──▶ create downloads
                      dedicated bridge SSE                │
                                 │                         │
                                 ▼                         │
                    Electron DiscoveryExecutor             │
                                 │                         │
                                 ▼                         │
                BrowserTabManager / SniffingHelper         │
                     │                       │              │
             visible user tabs       hidden Agent tab      │
                     │                       │              │
                     └──────── sources + private headers ───┘
```

Core is the system of record for Agent jobs. Electron is the system of record for browser tabs. A user tab may exist without a Core discovery job; a hidden Agent tab always has a `discoveryId`. This separation keeps standalone Core/Docker behavior explicit and prevents UI state from leaking into the backend domain.

## 3. Public contracts

### 3.1 Discovery model

Use these semantic fields in Go DTOs and TypeScript SDK types:

```ts
type DiscoveryMode = "auto" | "browser" | "inspect";
type DiscoveryStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled";

interface CreateDiscoveryInput {
  url: string;
  mode?: DiscoveryMode; // default: auto
  timeoutMs?: number; // 3_000...30_000, default: 20_000
  useSessionCookies?: boolean; // default: false
}

interface DiscoverySource {
  id: string;
  url: string;
  pageUrl: string;
  title: string;
  type: "m3u8" | "bilibili" | "direct" | "mediago" | "youtube";
  playlistType?: "master" | "media" | "unknown";
  maxQuality?: string;
  variants?: HLSVariantInspection[];
  detectedAt: string;
}

interface DiscoveryJob {
  id: string;
  input: CreateDiscoveryInput;
  status: DiscoveryStatus;
  sources: DiscoverySource[];
  partial: boolean;
  errorCode?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
}
```

The public representation must not contain `headers`, `cookies`, `authorization`, bridge identifiers, `webContentsId`, or Electron partition names.

### 3.2 HTTP API

| Method | Route                            | Purpose                                          | Success                                        |
| ------ | -------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `POST` | `/api/discoveries`               | Start `auto`, `browser`, or `inspect` discovery  | `202` for browser; `200` for completed inspect |
| `GET`  | `/api/discoveries/:id`           | Get one redacted job                             | `200`                                          |
| `POST` | `/api/discoveries/:id/cancel`    | Cancel queued/running work                       | `200`                                          |
| `POST` | `/api/discoveries/:id/downloads` | Create/start downloads from selected `sourceIds` | `200`                                          |
| `GET`  | `/api/discovery-executor/status` | Report browser-executor availability             | `200`                                          |

`mode=auto` routes URLs ending in `.m3u8` to the existing `M3U8Inspector`; all other HTTP(S) URLs require the Electron executor in V1. `mode=inspect` accepts only direct HLS URLs. `mode=browser` always requires Electron.

Suggested download handoff body:

```json
{
  "sourceIds": ["source-1"],
  "folder": "",
  "startDownload": true
}
```

Stable error codes:

- `discovery_not_found`
- `discovery_invalid_url`
- `discovery_invalid_mode`
- `discovery_executor_unavailable`
- `discovery_queue_full`
- `discovery_timeout`
- `discovery_cancelled`
- `discovery_source_not_found`
- `discovery_credentials_expired`
- `discovery_bridge_unauthorized`

### 3.3 MCP tools

- `discover_media`: read-like open-world operation; starts a discovery and waits up to `waitSeconds` (maximum 25). Returns a completed job or the pending job ID.
- `get_media_discovery`: returns the redacted job.
- `cancel_media_discovery`: cancels queued/running work.
- `download_discovered_media`: write operation that creates download tasks from source IDs.

Tool descriptions must state that `useSessionCookies=true` uses the signed-in desktop browser session and may access personalized content. It remains opt-in.

### 3.4 CLI

```shell
mediago discover <url> [--mode auto|browser|inspect] [--timeout 20s] [--session-cookies] [--json] [--no-wait]
mediago discover get <discovery-id> [--json]
mediago discover cancel <discovery-id>
mediago discover download <discovery-id> --source <source-id> [--source <source-id>] [--folder <folder>]
```

Human output prints title, type, URL, playlist type, and quality. `--json` prints the API `data` object exactly so Agents can parse a stable schema.

## 4. Private Electron bridge

Electron generates 32 random bytes before spawning Core and passes the hex token through `ServiceRunner.extraEnv` as `MEDIAGO_ELECTRON_BRIDGE_TOKEN`. Never put the token in command-line arguments or the persisted AppStore.

Private routes:

| Method | Route                                  | Purpose                                                                 |
| ------ | -------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/bridge/events`                   | Dedicated SSE stream; connection presence registers the single executor |
| `POST` | `/api/bridge/discoveries/:id/start`    | Acknowledge execution and transition to `running`                       |
| `POST` | `/api/bridge/discoveries/:id/complete` | Submit sources plus private headers                                     |
| `POST` | `/api/bridge/discoveries/:id/fail`     | Submit a stable failure code and safe message                           |

Bridge requests use an `Authorization: Bearer <bridge-token>` header, constant-time comparison, a 1 MiB body limit, and origin protection. The bridge stream emits `discovery-requested` and `discovery-cancelled`; it is separate from `/api/events` because the current generic hub broadcasts to every client and can drop events when a subscriber buffer is full.

Core store state is authoritative. On bridge reconnect, Core redispatches the current queued job rather than relying on SSE replay. If the stream disconnects during `running`, mark the job failed with `discovery_executor_disconnected`, destroy the Electron hidden view, and move to the next queued job after reconnection.

Private completion payload:

```ts
interface BridgeDiscoverySource extends DiscoverySource {
  headers?: string[]; // private; split and redacted before public storage
}
```

The discovery store maintains public source fields and private headers in separate maps. Sensitive header names are `cookie`, `authorization`, and `proxy-authorization`; their values must not enter logs, error messages, public DTOs, SSE broadcasts, or MCP content.

## 5. Electron tab model

```ts
interface BrowserTab {
  id: string;
  kind: "user" | "agent";
  discoveryId?: string;
  mode: "home" | "browser";
  status: "default" | "loading" | "loaded" | "failed";
  url: string;
  title: string;
  favicon?: string;
  errorCode?: number;
  errorMessage?: string;
  sources: SourceData[];
}

interface BrowserTabsState {
  tabs: BrowserTab[]; // user-visible tabs only
  activeTabId: string;
  sourcePanelCollapsed: boolean;
}
```

`BrowserTabManagerService` owns `Map<tabId, WebContentsView>`. It creates a view lazily when a tab first navigates, keeps inactive views alive, and attaches only the active view to the current main/browser window. Hidden Agent tabs are stored in a separate map and never added to the renderer's visible tab array unless a later feature explicitly promotes one.

`SniffingHelper` becomes a session-level dispatcher:

- One `webRequest.onSendHeaders` listener per Electron session.
- `webContentsId -> { tabId, discoveryId?, generation }` registration.
- Per-tab page info, URL dedup cache, inspection queue, and navigation generation.
- Every emitted renderer event carries `tabId`.
- Agent sessions collect results internally and send them to Core instead of renderer UI.

Do not register a second `webRequest` listener on the same Electron session for hidden jobs; central dispatch avoids listener replacement and cross-tab source leakage.

## 6. Multi-tab UX specification

### Layout

- Add a 36 px tab strip above the existing 56 px navigation toolbar.
- Tabs are 160 px preferred width, 96 px minimum, and 220 px maximum.
- The tab viewport scrolls horizontally, keeps the new-tab action pinned, and automatically scrolls the active tab into view.
- Use the existing surface, border, foreground, muted, focus-ring, and destructive tokens; introduce no new palette or font.
- Use the current application typeface at 13 px for labels and 11 px tabular numerals for source badges.
- Keep the source-panel collapsed state and resizable width global; keep URL, title, errors, history, and sources per tab.

### Interaction

- `+` creates and activates a home tab.
- Closing the active tab activates the right neighbor, otherwise the left neighbor.
- Closing the final tab creates a fresh home tab.
- A tab shows favicon/fallback icon, truncated title, loading spinner or failure icon, source-count badge, and close action.
- Middle-click closes a tab. A page-requested new window opens in a new tab.
- Favorite click loads the active tab; its context menu gains “Open in new tab”.
- The `+` action remains available regardless of tab count. If Electron cannot allocate another `WebContentsView`, keep all existing tabs intact and show an explicit creation error.
- Switching tabs reattaches the existing native view without navigation or source reset.

### Keyboard and accessibility

- Tab row uses `role="tablist"`; each tab uses `role="tab"`, `aria-selected`, `aria-controls`, and roving `tabIndex`.
- Arrow Left/Right changes focused tab; Enter/Space activates it; Delete closes when allowed.
- `Cmd/Ctrl+T` creates, `Cmd/Ctrl+W` closes, `Ctrl+Tab`/`Ctrl+Shift+Tab` cycles.
- All buttons retain visible focus rings and follow repository cursor rules.
- Loading uses `aria-label`; source counts have an accessible text equivalent; title truncation retains a `title` attribute.
- Empty, loading, failed, and no-matching-sources states remain independently correct for every tab.

## 7. Non-functional requirements

- Browser discovery timeout: default 20 s, maximum 30 s.
- Network quiet completion: 1.5 s without a new source after DOM ready, while respecting the hard timeout.
- Queue capacity: 20 Agent jobs; return `discovery_queue_full` beyond that.
- Visible tabs: no application-level count limit. Hidden Agent tab: maximum 1 running.
- Keep Electron's background throttling enabled for inactive views; only the active view is attached to a window.
- Public job retention: 10 minutes after terminal state.
- Bridge disconnect detection: immediate on SSE context cancellation; pending work remains queued, running work fails safely.
- Cancellation: destroy hidden `WebContentsView` within 1 s and ignore late completion using generation/job state checks.
- Core and Electron shutdown: close streams, destroy all views, cancel timers, and clear private header maps.
- No discovery URL query string, header value, or bridge token in info-level logs. Log only job ID, URL origin, mode, status, count, and duration.

## 8. Architecture decisions

### ADR-001: Core jobs with an Electron executor

**Status:** Accepted

**Context:** Browser sniffing needs Electron APIs and the user's authenticated browser session, while API/MCP/CLI contracts belong in Core and must also run when Core is hosted independently.

**Decision:** Core owns discovery jobs and delegates browser work over an authenticated bridge. Electron registers as an executor; Core never imports Electron concerns or starts GUI processes.

**Consequences:** Docker can expose inspect mode but returns `discovery_executor_unavailable` for browser mode. The bridge adds lifecycle handling, but preserves clean process boundaries.

**Alternatives considered:** Core launching Electron through OS commands was rejected as platform-specific and inverted ownership. Embedding Chromium in Core was rejected for V1 because of package size and operational cost.

### ADR-002: Dedicated SSE plus HTTP callbacks

**Status:** Accepted

**Context:** Electron already consumes SSE, but `/api/events` is lossy broadcast infrastructure rather than a targeted command channel.

**Decision:** Add a dedicated authenticated bridge SSE stream for Core-to-Electron commands and HTTP callbacks for acknowledgements/results.

**Consequences:** This reuses current dependencies and reconnect behavior. It is half-duplex at the transport level, but the protocol is easy to test and sufficient for one executor.

**Alternatives considered:** Polling was rejected for latency and unnecessary traffic. WebSocket was deferred because bidirectional framing is not necessary in V1.

### ADR-003: One WebContentsView per visible tab

**Status:** Accepted

**Context:** React-only tabs over one WebContents would lose page execution state and navigation history.

**Decision:** Keep one native view per visible tab and attach only the active view.

**Consequences:** Switching is instant and stateful, but memory grows per tab. V1 has no hard count limit, keeps background throttling enabled, and fails a new-tab creation cleanly if the operating system cannot allocate another view. Automatic suspension remains a possible later optimization rather than a hidden V1 behavior.

**Alternatives considered:** Reload-on-switch was rejected for broken UX and missed media requests. One BrowserWindow per tab was rejected as operationally heavy.

### ADR-004: Ephemeral private credentials

**Status:** Accepted

**Context:** Authenticated discovery may capture cookies needed for download, but exposing or persisting them unnecessarily creates a high-impact secret leak.

**Decision:** Store sensitive headers only in Core memory and use them only for immediate download enqueue. Public job DTOs remain redacted; no database migration stores session credentials.

**Consequences:** A session-backed download cannot be restarted after Core restart without rediscovery. This limitation must be visible in error handling and documentation.

**Alternatives considered:** Persisting plaintext headers was rejected. Encryption-at-rest was deferred because it requires key lifecycle and migration work outside V1.

## 9. Implementation tasks

Implementation should use `@Code` for execution discipline, `@security-auditor` for bridge and credential review, `@vercel-react-best-practices` for React/Zustand changes, and `@ui-ux-pro-max` for the tab interaction review.

### Task 1: Add shared discovery and browser-tab contracts

**Files:**

- Modify: `packages/core-sdk/src/types.ts`
- Modify: `packages/shared/common/src/types/index.ts`
- Modify: `packages/shared/common/src/constants/events.ts`
- Modify: `apps/ui/src/types.d.ts`
- Test: `packages/core-sdk/test-dts/public-api.ts` if present; otherwise add `packages/core-sdk/tests/types.test.ts`

**Steps:**

1. Add a compile-time test importing `DiscoveryJob`, `CreateDiscoveryParams`, `BrowserTabSnapshot`, and tab-aware `PlatformApi.browser` methods.
2. Run `pnpm -F @mediago/core-sdk run type:check` and confirm the test fails because the contracts do not exist.
3. Add the public discovery types above, bridge command/result types under an explicitly internal section, and tab-aware IPC payloads.
4. Replace the legacy two-field `BrowserStore` shared type with `BrowserTabsSnapshot`; do not include private headers.
5. Run `pnpm -F @mediago/core-sdk run type:check && pnpm -F @mediago/shared-common run type:check` and expect success.
6. Commit: `feat(shared): define discovery and browser tab contracts`.

### Task 2: Implement the Core discovery store and state machine

**Files:**

- Create: `apps/core/internal/discovery/types.go`
- Create: `apps/core/internal/discovery/store.go`
- Create: `apps/core/internal/discovery/store_test.go`
- Create: `apps/core/internal/discovery/service.go`
- Create: `apps/core/internal/discovery/service_test.go`

**Steps:**

1. Write table tests for valid transitions: `pending -> running -> completed|failed|cancelled`; terminal states reject late callbacks.
2. Add tests for queue capacity 20, one running browser job, ten-minute expiry, cancellation, and redaction of sensitive headers.
3. Run `cd apps/core && go test ./internal/discovery -run 'Test(Store|Service)'` and confirm failure.
4. Implement a mutex-protected in-memory store, injected clock/ID generator, public/private source separation, and cleanup.
5. Implement `Start`, `Get`, `Cancel`, `MarkRunning`, `Complete`, `Fail`, `ExecutorAvailable`, and queue dispatch methods.
6. Run the focused tests and `cd apps/core && go test -race ./internal/discovery`.
7. Commit: `feat(core): add ephemeral media discovery service`.

### Task 3: Reuse HLS inspection through discovery inspect mode

**Files:**

- Modify: `apps/core/internal/service/m3u8_inspector.go`
- Modify: `apps/core/internal/discovery/service.go`
- Test: `apps/core/internal/discovery/service_test.go`
- Test: `apps/core/internal/service/m3u8_inspector_test.go`

**Steps:**

1. Add tests that `mode=inspect` completes synchronously with master-playlist variants and never asks for an Electron executor.
2. Add tests rejecting non-HTTP(S), non-M3U8 inspect inputs and clamping timeouts to 3–30 seconds.
3. Run the focused Go tests and confirm failure.
4. Inject the existing `M3U8Inspector` behind a small interface and map `SourceInspection` into `DiscoverySource`.
5. Preserve the current 2 MiB response limit and five-second inspector timeout.
6. Run `cd apps/core && go test ./internal/discovery ./internal/service`.
7. Commit: `feat(core): expose HLS inspection through discovery jobs`.

### Task 4: Add the authenticated Electron bridge

**Files:**

- Create: `apps/core/internal/discovery/broker.go`
- Create: `apps/core/internal/discovery/broker_test.go`
- Create: `apps/core/internal/api/handler/discovery_bridge.go`
- Create: `apps/core/internal/api/handler/discovery_bridge_test.go`
- Modify: `apps/core/internal/app/config.go`
- Modify: `apps/core/internal/api/server/server.go`
- Modify: `apps/core/internal/api/server/router.go`
- Modify: `apps/core/cmd/server/main.go`

**Steps:**

1. Write tests for missing/wrong bridge token, constant-time protected success, one-executor ownership, reconnect redispatch, disconnect failure, cancellation, and late-result rejection.
2. Run `cd apps/core && go test ./internal/discovery ./internal/api/handler -run 'Test.*Bridge'` and confirm failure.
3. Read `MEDIAGO_ELECTRON_BRIDGE_TOKEN` into runtime config without persisting or logging it.
4. Implement dedicated SSE framing, keepalive comments, body limits, origin checks, and callback handlers.
5. Ensure bridge routes are not accidentally authorized by the public API key and are not part of generic CORS behavior.
6. Run focused tests and `cd apps/core && go test -race ./internal/discovery ./internal/api/...`.
7. Commit: `feat(core): add authenticated Electron discovery bridge`.

### Task 5: Add public discovery API and download handoff

**Files:**

- Create: `apps/core/internal/api/dto/discovery.go`
- Create: `apps/core/internal/api/handler/discovery.go`
- Create: `apps/core/internal/api/handler/discovery_test.go`
- Modify: `apps/core/internal/api/handler/error_response.go`
- Modify: `apps/core/internal/api/server/server.go`
- Modify: `apps/core/internal/api/server/router.go`
- Modify: `apps/core/internal/service/download_task.go`
- Modify: `apps/core/internal/service/download_task_test.go`
- Modify: `apps/core/internal/i18n/keys.go`
- Modify: `apps/core/internal/i18n/i18n.go`

**Steps:**

1. Write handler tests for `202` browser jobs, `200` inspect jobs, unavailable executor, invalid URL/mode, get, cancel, selected-source download, expired credentials, and redacted output.
2. Write service tests for enqueueing a discovered download with runtime-only sensitive headers while persisting only non-sensitive fields.
3. Run the focused tests and confirm failure.
4. Implement handlers and stable error mapping; use `urlOriginForLog`-style logging rather than full URL logging.
5. Add `StartDownloadWithRuntimeHeaders` (or an equivalent narrow method) so queue params receive private headers without writing them to `db.Video.Headers`.
6. Broadcast only safe discovery status changes on generic `/api/events` if the UI needs them; never broadcast private source payloads.
7. Run `cd apps/core && go test ./internal/api/... ./internal/service ./internal/discovery`.
8. Commit: `feat(api): expose media discovery endpoints`.

### Task 6: Extend the TypeScript SDK

**Files:**

- Modify: `packages/core-sdk/src/client.ts`
- Modify: `packages/core-sdk/src/eventEmitter.ts`
- Create: `packages/core-sdk/src/bridgeClient.ts`
- Modify: `packages/core-sdk/src/index.ts`
- Modify: `packages/core-sdk/tests/client.test.ts`
- Create: `packages/core-sdk/tests/bridgeClient.test.ts`

**Steps:**

1. Write request-contract tests for create/get/cancel/download discovery methods.
2. Write bridge tests proving the token is sent as an authorization header, commands are parsed, cancellation is emitted, malformed data raises an error, and close releases listeners.
3. Run `pnpm vitest run packages/core-sdk/tests/client.test.ts packages/core-sdk/tests/bridgeClient.test.ts` and confirm failure.
4. Add public methods to `MediaGoClient`; keep private callbacks in a separate `MediaGoBridgeClient` to prevent accidental UI use.
5. Implement bounded request timeouts and abort propagation.
6. Run focused tests and package type-check.
7. Commit: `feat(sdk): add media discovery and bridge clients`.

### Task 7: Expose discovery through MCP

**Files:**

- Modify: `apps/core/internal/mcpserver/server.go`
- Modify: `apps/core/internal/mcpserver/server_test.go`
- Modify: `apps/core/cmd/server/main.go`
- Modify: `apps/core/internal/api/server/mcp_test.go`

**Steps:**

1. Add MCP integration tests that list/call the four tools and verify tool annotations, redacted output, bounded wait, cancellation, and unavailable executor errors.
2. Run `cd apps/core && go test ./internal/mcpserver ./internal/api/server -run 'Test.*MCP'` and confirm failure.
3. Inject the discovery service into `mcpserver.Manager` beside the existing download service.
4. Implement tool handlers as thin adapters; do not duplicate URL validation or job transitions.
5. Ensure `download_discovered_media` is marked non-read-only and `discover_media` declares open-world network access.
6. Run focused tests and all Core tests.
7. Commit: `feat(mcp): expose media discovery tools`.

### Task 8: Expose discovery through CLI

**Files:**

- Modify: `apps/core/cmd/cli/main.go`
- Modify: `apps/core/cmd/cli/main_test.go`

**Steps:**

1. Add HTTP fixture tests for `discover`, `get`, `cancel`, `download`, JSON output, bounded polling, Ctrl+C cancellation, and server error codes.
2. Run `cd apps/core && go test ./cmd/cli` and confirm failure.
3. Add Cobra commands using the same wire contracts as the HTTP API.
4. Default to waiting; `--no-wait` prints the job ID immediately. Keep `--session-cookies` opt-in.
5. Ensure human output never prints private headers and JSON output is the redacted API data object.
6. Run `cd apps/core && go test ./cmd/cli`.
7. Commit: `feat(cli): add media discovery commands`.

### Task 9: Connect Electron to the Core bridge

**Files:**

- Modify: `apps/electron/src/services/downloader.server.ts`
- Modify: `apps/electron/src/services/downloader.server.test.ts`
- Create: `apps/electron/src/services/discovery-executor.service.ts`
- Create: `apps/electron/src/services/discovery-executor.service.test.ts`
- Modify: `apps/electron/src/app.ts`

**Steps:**

1. Write tests proving a unique bridge token is generated for each Core start and passed through `extraEnv`, not `extraArgs` or logs.
2. Write executor tests for sequential jobs, start/complete/fail callbacks, cancellation, reconnect, and shutdown cleanup.
3. Run focused Vitest files and confirm failure.
4. Construct `MediaGoBridgeClient` after Core health succeeds and dispatch commands into `DiscoveryExecutorService`.
5. Close bridge events before stopping `ServiceRunner`; ignore stale completions after stop/restart generation changes.
6. Preserve `internal: false` LAN behavior for existing desktop/mobile/extension use; bridge authentication provides isolation.
7. Run focused tests and Electron type-check.
8. Commit: `feat(electron): register browser discovery executor`.

### Task 10: Refactor sniffing into a tab-aware coordinator

**Files:**

- Modify: `apps/electron/src/services/sniffing-helper.service.ts`
- Create: `apps/electron/src/services/sniffing-helper.service.test.ts`
- Modify: `apps/electron/src/utils/source-inspection.ts`
- Modify: `packages/shared/common/src/sniff/source-grouping.ts`
- Modify: `packages/shared/common/src/sniff/source-grouping.test.ts`

**Steps:**

1. Add tests with two `webContentsId` values proving navigation, page metadata, dedup, HLS inspection, and emitted sources never cross tabs.
2. Add tests for Agent collection, network-quiet completion, hard timeout, cancellation, and late HLS-inspection response rejection.
3. Run focused tests and confirm failure.
4. Replace singleton page/cache state with context maps keyed by tab ID and route network events by `webContentsId`.
5. Keep a single Electron `webRequest` listener per partition and provide explicit register/unregister APIs.
6. Split headers into public and private sets before returning an Agent result.
7. Run focused tests and `pnpm -F @mediago/electron run type:check`.
8. Commit: `refactor(electron): make media sniffing tab aware`.

### Task 11: Implement the Electron BrowserTabManager

**Files:**

- Move: `apps/electron/src/services/webview.service.ts` to `apps/electron/src/services/browser-tab-manager.service.ts`
- Move: `apps/electron/src/services/webview.service.test.ts` to `apps/electron/src/services/browser-tab-manager.service.test.ts`
- Modify: `apps/electron/src/controller/webview.controller.ts`
- Modify: `apps/electron/src/app.ts`
- Modify: `apps/electron/src/windows/browser.window.ts`
- Modify: `apps/electron/src/windows/main.window.ts`

**Steps:**

1. Update existing WebContents mocks to support multiple views and stable numeric IDs.
2. Add tests for lazy creation, creating and switching at least 25 tabs without an application-level rejection, activation attach/detach, clean allocation failure, close-neighbor selection, last-tab home reset, popup-to-new-tab, window reparenting, proxy/ad-block/UA propagation, and destroy cleanup.
3. Run the manager tests and confirm failure.
4. Replace the singleton view with `Map<tabId, TabRuntime>` and bind each view to `SniffingHelper` registration.
5. Add hidden Agent view creation/destruction APIs used only by `DiscoveryExecutorService`.
6. Ensure inactive views are not attached to a window but remain alive; attach the active view only after the renderer supplies bounds.
7. Run focused tests and Electron type-check.
8. Commit: `feat(electron): add multi-tab browser view manager`.

### Task 12: Make preload and IPC tab-aware

**Files:**

- Modify: `packages/electron-preload/src/index.ts`
- Modify: `packages/shared/common/src/constants/events.ts`
- Modify: `packages/shared/common/src/types/index.ts`
- Modify: `apps/ui/src/hooks/adapters/platform-stubs.ts`
- Modify: `apps/electron/src/controller/webview.controller.ts`
- Modify: `apps/electron/src/controller/home.controller.ts`
- Modify: `apps/electron/src/controller/home.controller.test.ts` if added; otherwise cover through controller/application tests

**Steps:**

1. Add compile-time and controller tests for `createTab`, `activateTab`, `closeTab`, and tab-scoped navigation/bounds methods.
2. Run shared/preload/Electron type-check and confirm failure.
3. Update `PlatformApi.browser` and every IPC handler to require `tabId` where applicable.
4. Replace untyped `HomeController.sharedState` with `BrowserTabsSnapshot`; keep it in memory only and support main-window/browser-window handoff.
5. Include `tabId` in `domReady`, navigation, failure, and source events.
6. Run type-check and focused tests.
7. Commit: `feat(ipc): add tab-scoped browser contracts`.

### Task 13: Migrate the Zustand browser store

**Files:**

- Rewrite: `apps/ui/src/store/browser.ts`
- Rewrite: `apps/ui/src/store/browser.test.ts`
- Modify: `apps/ui/src/hooks/use-browser-actions.ts`
- Modify: `apps/ui/src/hooks/use-desktop-events.ts`

**Steps:**

1. Write store tests for initial home tab, add/activate/close, close fallback, at least 25 tabs without a business-rule limit, per-tab navigation/error/sources, HLS grouping isolation, global panel collapse, and snapshot hydration.
2. Run `pnpm vitest run apps/ui/src/store/browser.test.ts` and confirm failure.
3. Implement actions with explicit `tabId`; selectors must derive the active tab without making every component subscribe to the full tabs array.
4. Ensure stale Electron events for closed tabs are ignored.
5. Keep tab snapshots free of private headers where they cross renderer instances.
6. Run focused tests and UI type-check.
7. Commit: `feat(ui): add multi-tab source extraction state`.

### Task 14: Build the tab strip and update the source-extraction page

**Files:**

- Create: `apps/ui/src/pages/source-extract/components/browser-tab-strip.tsx`
- Create: `apps/ui/src/pages/source-extract/components/browser-tab-strip-logic.ts`
- Create: `apps/ui/src/pages/source-extract/components/browser-tab-strip-logic.test.ts`
- Modify: `apps/ui/src/pages/source-extract/index.tsx`
- Modify: `apps/ui/src/pages/source-extract/components/tool-bar.tsx`
- Modify: `apps/ui/src/pages/source-extract/components/browser-view.tsx`
- Modify: `apps/ui/src/pages/source-extract/components/browser-view-panel.tsx`
- Modify: `apps/ui/src/pages/source-extract/components/favorite-list.tsx`
- Modify: `apps/ui/src/components/web-view.tsx`
- Modify: `packages/shared/common/src/i18n/resources/en.ts`
- Modify: `packages/shared/common/src/i18n/resources/zh.ts`
- Modify: `packages/shared/common/src/i18n/resources/it.ts`

**Steps:**

1. Add pure logic tests for close fallback, cyclic keyboard navigation, labels, badge caps, horizontal overflow, active-tab scroll targeting, and an always-available new-tab action.
2. Run focused tests and confirm failure.
3. Implement the 36 px accessible tab strip using existing Button/Tooltip/Badge primitives and repository cursor semantics.
4. Update the toolbar, WebView bounds, favorites, source panel, error state, and document title to use the active tab.
5. Register keyboard shortcuts only while the source-extraction surface is active; prevent them from firing inside editable fields where appropriate.
6. Verify loading, empty, failed, collapsed, no-match, large-tab-count overflow, and native-view allocation-error states in light/dark modes.
7. Run focused tests, UI type-check, lint, and format check.
8. Commit: `feat(ui): add accessible source extraction tabs`.

### Task 15: Add integration and end-to-end coverage

**Files:**

- Create: `tests/e2e/electron/source-extraction-tabs.spec.ts`
- Create: `tests/e2e/electron/agent-discovery.spec.ts`
- Modify: `tests/e2e/support/core-process.ts`
- Add Core HTTP integration coverage under `apps/core/internal/api/server/` if the existing E2E harness cannot exercise bridge failure modes deterministically

**Steps:**

1. Add an Electron fixture page that emits distinct media URLs for two tabs.
2. Verify two tabs preserve URL, history, title, page execution state, and isolated source counts while switching.
3. Verify closing active/background/final tabs and opening, scrolling, switching, and closing at least 25 tabs.
4. Start an API discovery, verify the visible tab is not navigated, wait for the hidden result, and create a download from its source ID.
5. Verify executor unavailable, timeout with partial sources, cancellation, bridge disconnect, session-cookie opt-in, and response redaction.
6. Run `pnpm test:e2e:build` followed by the two focused Playwright specs.
7. Run `pnpm test:go`, `pnpm test:ts`, `pnpm type:check`, `pnpm lint`, and `pnpm format:check`.
8. Commit: `test(discovery): cover Agent discovery and browser tabs`.

### Task 16: Publish intentional API and user documentation

**Files:**

- Modify: `docs/api.md`
- Modify: `docs/en/api.md`
- Modify: `docs/it/api.md`
- Modify: `docs/jp/api.md`
- Modify: `docs/documents.md`
- Modify: `docs/en/documents.md`
- Modify: `docs/it/documents.md`
- Modify: `docs/jp/documents.md`
- Modify: `apps/core/README.md`

**Steps:**

1. Document HTTP discovery endpoints, opt-in session cookies, executor requirements, errors, MCP tools, and CLI examples.
2. Document the multi-tab behavior, horizontal overflow, lack of an application-level tab limit, system-resource caveat, shortcuts, non-persistence, and hidden Agent tasks.
3. State that browser discovery is unavailable in standalone Docker unless a future remote executor is attached.
4. State that DRM/access-control bypass is unsupported and session-derived credentials expire on restart.
5. Run `pnpm docs:build` and inspect `git status --short -- docs` to ensure only intentional public documentation changed.
6. Commit: `docs: document media discovery and browser tabs`.

## 10. Verification matrix

| Layer                   | Primary verification                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Discovery state machine | Go unit tests with injected clock and race detector                                    |
| HLS inspection          | Existing local HTTP fixture tests plus discovery mapping tests                         |
| Bridge authentication   | Gin handler tests, wrong-token tests, origin tests, token redaction tests              |
| MCP                     | In-process MCP client calls over authenticated test transport                          |
| CLI                     | `httptest.Server` fixtures and captured stdout/stderr                                  |
| SDK                     | Vitest request/response and EventSource mocks                                          |
| Electron executor       | Vitest fake bridge plus fake multi-view Electron runtime                               |
| Tab store               | Pure Zustand tests with two or more tab IDs                                            |
| Tab UI                  | Pure navigation logic tests plus Electron Playwright E2E                               |
| Secret handling         | Tests that search serialized public responses/log arguments for sentinel credentials   |
| Full regression         | `pnpm test`, `pnpm type:check`, `pnpm lint`, `pnpm format:check`, focused Electron E2E |

## 11. Rollout order and release gates

1. Merge Core discovery state machine and inspect mode behind no UI changes.
2. Merge the authenticated bridge and SDK with browser mode disabled unless a valid executor is connected.
3. Merge Electron hidden executor and validate API/MCP/CLI discovery end to end.
4. Merge tab-aware sniffing and BrowserTabManager behind the existing single visible tab.
5. Enable the multi-tab strip after state/isolation E2E passes.
6. Publish API/user documentation.

Release is blocked if any of these are true:

- A public response, MCP result, CLI output, generic SSE event, or log contains sentinel Cookie/Authorization values.
- A source detected in one tab appears in another tab.
- An Agent discovery navigates or replaces the active visible tab.
- A bridge disconnect leaves a job indefinitely `running`.
- Closing a tab leaves a live `WebContentsView`, timer, or sniffing registration.
- Standalone Core reports browser discovery as available without a connected executor.

## 12. Risks and mitigations

| Risk                                             | Mitigation                                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron memory growth                           | No hard tab limit; keep background throttling enabled, attach only the active view, destroy closed views, preserve existing tabs on allocation failure, and consider explicit user-visible suspension only after V1 metrics |
| Shared-session listener conflicts                | One session-level `webRequest` dispatcher keyed by `webContentsId`                                                                                                                                                          |
| Late async events corrupt a new navigation       | Per-tab generation and job-state checks                                                                                                                                                                                     |
| SSE command loss                                 | Core store remains authoritative and redispatches queued work on reconnect                                                                                                                                                  |
| Cookie leakage                                   | Private/public source split, sentinel tests, runtime-only header injection, no raw URL/header logs                                                                                                                          |
| LAN-exposed Core bridge                          | 256-bit ephemeral bridge token via environment, constant-time checks, body limit, origin protection                                                                                                                         |
| Core restart breaks authenticated retry          | Explicit `discovery_credentials_expired`; require rediscovery                                                                                                                                                               |
| UI store duplication across two renderer windows | Main-process typed snapshot and tab manager as native-view authority                                                                                                                                                        |
| Scope expansion into a full browser              | V1 excludes persistence, tab suspension, bookmarks redesign, multiple executors, and developer tools                                                                                                                        |

## 13. Acceptance criteria

- An Agent can call MCP, HTTP, or CLI with a page URL and receive normalized, redacted media sources.
- Explicit HLS inspection works without Electron.
- Browser discovery clearly reports unavailable when no Electron executor is connected.
- With Electron running, Agent discovery uses a hidden tab and leaves the active visible page unchanged.
- A user can open at least 25 source-extraction tabs with no application-level rejection, scroll and switch among them without reload, and see isolated sources/history/errors.
- Tabs support mouse and documented keyboard interactions with correct focus and cursor behavior.
- Closing/cancelling destroys the relevant native view and ignores late network callbacks.
- Selected discovery sources can create and start downloads with runtime session credentials.
- No public output or log exposes Cookie, Authorization, Proxy-Authorization, or the bridge token.
- All focused tests and repository health checks pass.
