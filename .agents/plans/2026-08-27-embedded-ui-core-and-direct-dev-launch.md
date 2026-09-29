# Embedded UI Core and Direct Development Launch Implementation Plan

**Goal:** Embed the server-target main UI and Player UI in every `mediago-core` binary, keep the main UI unavailable when Core is launched by Electron, remove disk-backed static serving and `apps/server`, and let Task launch the Web development Core directly.

**Architecture:** The Core binary owns both embedded filesystems. `/player/` is always registered; the main SPA and Web Share Target are registered only when the existing Electron bridge token is absent. Docker runs Core directly with authentication, while Electron continues to supervise Core through `@mediago/service-runner`. Development Task commands run the Core binary directly alongside the appropriate Vite process.

**Tech stack:** Go `embed`/`io/fs`, Gin, Vite, pnpm/Turborepo, Task, Docker, Vitest and Go tests.

---

### Task 1: Generalize embedded frontend assets

**Files:**

- Modify: `packages/tooling/src/core-build/config.ts`
- Modify: `packages/tooling/src/core-build/dev.ts`
- Rename/generalize: `packages/tooling/src/core-build/player-assets.ts`
- Modify: `packages/tooling/src/github/core-embed-assets.test.ts`
- Modify: `apps/core/assets/embed.go`
- Create: `apps/core/assets/web/placeholder.txt`
- Modify: `apps/core/.gitignore`

Steps:

1. Add failing tests covering replacement and placeholder tracking for both main UI and Player UI.
2. Generalize the asset replacement helper and build both Vite applications before Core compilation.
3. Embed `web/*` and `player/*` in Core and verify the tooling tests.

### Task 2: Serve embedded UI without `static-dir`

**Files:**

- Modify: `apps/core/internal/api/server/player_static.go`
- Modify: `apps/core/internal/api/server/server.go`
- Modify: `apps/core/internal/api/server/web_share_test.go`
- Modify: `apps/core/cmd/server/main.go`
- Modify: `apps/core/internal/app/config.go`
- Modify: associated Go config/server tests

Steps:

1. Add tests for embedded main SPA assets, PWA headers, SPA fallback, and Electron route suppression.
2. Generalize the embedded SPA handler to `fs.FS`.
3. Register `/player/` unconditionally and register the main SPA only when `ElectronBridgeToken` is empty.
4. Remove the `StaticDir` field and `--static-dir` flag.
5. Run focused Go tests.

### Task 3: Remove the Node server adapter and launch Core from Task

**Files:**

- Delete: `apps/server/**`
- Modify: `package.json`
- Modify: `Taskfile.yml`
- Modify: `tests/e2e/support/server-process.ts`
- Modify: `tests/e2e/support/server-shutdown.ts`
- Modify: build/task contract tests and smoke readiness markers

Steps:

1. Replace `@mediago/server` in development scripts with a Task command that executes the current-platform Core binary directly using explicit port, auth, data, log, schema, and dependency arguments.
2. Keep `dev:web` as Core plus Web Vite and `dev:all` as Web Core plus Electron and both Vite surfaces.
3. Replace E2E Node-wrapper startup with direct Core startup.
4. Remove `build:server` and Node server bundle verification.
5. Delete `apps/server` and update the lockfile.

### Task 4: Simplify Docker and clean legacy Player resolution

**Files:**

- Modify: `Dockerfile`
- Modify: `docker/docker-entrypoint.sh`
- Modify: `apps/electron/src/utils/binaryResolver.ts`
- Modify: public repository documentation that describes `apps/server`

Steps:

1. Remove `/app/static` copying and the `--static-dir` argument.
2. Keep a single embedded `mediago-core` runtime binary.
3. Delete unused `resolvePlayerBinary()` and `MEDIAGO_PLAYER_BIN` documentation.
4. Update intentional public documentation and verify no stale server-adapter references remain.

### Task 5: Verification

1. Run focused Vitest tests for asset tooling, Task contracts, process helpers, and UI URL behavior.
2. Run focused Go tests for embedded SPA routing, Electron suppression, auth, MCP, and Web Share Target.
3. Run TypeScript type checks, Go tests, formatting, and lint.
4. Build Core, Electron-target UI, Docker-target UI, Player UI, and the Docker image build stages when available.
5. Run `task dev:web`/`task dev:all` smoke verification and confirm direct Core shutdown leaves no owned processes.
