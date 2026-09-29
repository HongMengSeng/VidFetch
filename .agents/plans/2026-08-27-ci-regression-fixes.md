# CI Regression Fixes Implementation Plan

**Goal:** Restore the TypeScript and three-surface Playwright jobs without weakening production output validation.

**Architecture:** Keep the browser-tab manager unit test isolated from the real downloader service graph. Normalize Electron's established IPC response envelope only in raw-IPC E2E tests. Make the fake BBDown executable honor the production output flags by writing a deterministic non-empty media artifact.

**Tech Stack:** TypeScript, Vitest, Playwright, Electron IPC, Node.js test fixtures.

---

### Task 1: Isolate the browser-tab manager unit suite

**Files:**

- Modify: `apps/electron/src/services/browser-tab-manager.service.test.ts`

1. Mock `sniffing-helper.service` with the error class and injectable service token needed by the subject.
2. Run the browser-tab manager Vitest suite.

### Task 2: Normalize raw Electron IPC results in E2E tests

**Files:**

- Create: `tests/e2e/support/electron-ipc.ts`
- Create: `tests/e2e/support/electron-ipc.test.ts`
- Modify: `tests/e2e/electron/agent-discovery.spec.ts`
- Modify: `tests/e2e/electron/source-extraction-tabs.spec.ts`

1. Test success-envelope unwrapping, raw-value passthrough, and error-envelope rejection.
2. Implement the generic helper.
3. Route direct `window.electron.browser` calls through the helper.
4. Run the helper unit suite and E2E TypeScript check.

### Task 3: Align fake BBDown with the downloader output contract

**Files:**

- Modify: `tests/e2e/support/fake-dependencies.ts`
- Modify: `tests/e2e/support/fake-dependencies.test.ts`

1. Add a regression test requiring a non-empty `<file-pattern>.mp4` under `--work-dir`.
2. Update the fake executable to record argv and create that deterministic artifact when both output flags are present.
3. Run the fake-dependency Vitest suite.

### Task 4: Verify the CI paths

1. Run the affected Vitest suites together.
2. Run `pnpm type:check:e2e`.
3. Run the three-surface Playwright suite when the local platform supports it; otherwise run the closest build/type checks and report the limitation.
4. Inspect `git diff` and `git status`; do not stage, commit, or push.
