# Actions Build Failures Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Docker and desktop release builds deterministic after the settings-promotion assets and generated workspace packages were introduced.

**Architecture:** Copy the promotion assets into the Docker Node builder before Vite runs. Route the Core-embedded main UI through the repository's canonical Turbo build so workspace dependencies are produced first, then express the desktop workspace build as depending on the completed Core build instead of running both against the same outputs concurrently.

**Tech Stack:** Docker, Go Task, pnpm, Turborepo, TypeScript, Vitest.

---

### Task 1: Lock the failing build contracts

**Files:**

- Modify: `packages/tooling/src/contracts/taskfile-contract.test.ts`
- Create: `packages/tooling/src/core-build/dev.test.ts`

**Step 1: Add a Docker contract assertion**

Assert that the Docker build copies `remote-config/assets/` before `pnpm build:web:raw`.

**Step 2: Add a desktop task-graph assertion**

Update the expected graph so `internal:build:electron:workspace` depends on `internal:core:build:production`, making the workspace leaf wait for the Core build.

**Step 3: Add a Core UI build-plan test**

Assert that the main UI runs `pnpm build:web:raw` from the workspace root while the player UI keeps its package-local build.

**Step 4: Run the tests and confirm they fail**

Run:

```bash
pnpm exec vitest run packages/tooling/src/contracts/taskfile-contract.test.ts packages/tooling/src/core-build/dev.test.ts
```

Expected: failures until the Dockerfile, Taskfile, and Core build implementation are updated.

### Task 2: Implement deterministic build ordering

**Files:**

- Modify: `Dockerfile`
- Modify: `Taskfile.yml`
- Modify: `packages/tooling/src/core-build/config.ts`
- Modify: `packages/tooling/src/core-build/dev.ts`

**Step 1: Copy the remote promotion assets**

Add `COPY remote-config/assets/ remote-config/assets/` alongside the source copies used by the Node builder.

**Step 2: Use the dependency-aware web build**

Add the workspace root to the Core build configuration and make the main embedded UI run the canonical root `build:web:raw` script. Keep the player build package-local because it has no generated workspace runtime dependencies.

**Step 3: Serialize desktop workspace output generation**

Make `internal:build:electron` depend on `internal:build:electron:workspace`, and make that workspace task depend on both Node dependencies and `internal:core:build:production`. Task will then finish Core/UI embedding before running the Electron Turbo leaf.

### Task 3: Verify the fixes

**Files:**

- Verify only; do not commit or push.

**Step 1: Run focused tests**

```bash
pnpm exec vitest run packages/tooling/src/contracts/taskfile-contract.test.ts packages/tooling/src/core-build/dev.test.ts packages/tooling/src/github/core-embed-assets.test.ts
```

Expected: all tests pass.

**Step 2: Run tooling type checks and formatting checks**

```bash
pnpm --filter @mediago/tooling run type:check
pnpm exec oxfmt --check Dockerfile Taskfile.yml packages/tooling/src/core-build/config.ts packages/tooling/src/core-build/dev.ts packages/tooling/src/core-build/dev.test.ts packages/tooling/src/contracts/taskfile-contract.test.ts
```

Expected: no type or formatting errors.

**Step 3: Run dependency-aware web and Task graph verification**

```bash
pnpm build:web:raw
task --dry --force build:electron
```

Expected: the UI and its workspace dependencies build successfully, and the dry-run orders Core before the Electron workspace leaf.

**Step 4: Inspect the final diff and repository status**

Confirm that only the planned source, tests, and internal plan changed. Do not stage, commit, or push.
