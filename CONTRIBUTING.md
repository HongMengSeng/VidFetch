# Contributing to MediaGo

Thanks for your interest in hacking on MediaGo! This doc covers everything
you need to get a local dev build running. For user-facing usage, see the
main [README](./README.md).

## Prerequisites

- **Node.js** ≥ 24.14 — install from [nodejs.org](https://nodejs.org/)
- **pnpm** 11.23 — activated from the repository's `packageManager` field
- **Go** ≥ 1.25 — install from [go.dev](https://go.dev/dl/)
- **Task** ≥ 3.51.1 and < 4.0.0 — the repository task runner

Install the latest compatible Task v3 release on macOS, Linux, or Windows
(PowerShell) with the Go toolchain. Make sure the Go binary directory is on
`PATH`, then verify the installed version:

```shell
go install github.com/go-task/task/v3/cmd/task@latest
task --version
```

## Clone & install

```shell
git clone https://github.com/caorushizi/mediago.git
cd mediago
task setup
task dev:all
```

`task setup` installs both the Node workspace and the runtime tools required
by the application. Runtime versions come only from
`packages/tooling/manifests/runtime-deps.json`; Task does not automatically upgrade them.
Running `pnpm install` alone installs Node packages, but not BBDown or the
other runtime binaries.

## Repository layout

MediaGo is a pnpm + Turborepo monorepo with three products that share the
same Go Core backend:

```
apps/
  core/            Go backend with embedded main and Player UIs
  electron/        Electron desktop main process
  ui/              Shared React 19 frontend (Electron + Web)
  player-ui/       React frontend embedded inside Go Core for playback
packages/
  common/   Cross-platform types, constants, i18n resources
  core-sdk/        TypeScript SDK for the Go Core REST API
  electron-preload/
  mediago-extension/  Browser extension (Chrome / Edge)
  tooling/         Shared bootstrap, build, release, verification and Vite tooling
.github/
  actions/         Reusable CI setup actions
docker/            Container entrypoint and Docker assets
docs/              VitePress site (zh / en / jp)
```

Deeper architecture notes live in [`CLAUDE.md`](./CLAUDE.md).

## Everyday commands

```shell
# Prepare the Node workspace and all pinned runtime tools
task setup

# Run the unified desktop + web development experience
task dev:all

# Run the Electron desktop app in dev mode (HMR)
task dev:electron

# Run the Web Core and Vite UI in development mode
task dev:web

# Build the deployable Web product as a Docker image
task build:docker

# Build the Electron workspace without creating an installer
task build:electron

# Build an unpacked Electron directory (fast, for smoke-testing layout)
task pack:electron

# Build full Electron installers for distribution (.exe / .dmg / .deb)
task release:electron

# Lint + format + type-check (what CI runs)
task check

# Run the TypeScript and Go test suites
task test
```

Task is the public command interface for setup, development, builds, tests,
and releases. Turborepo schedules JavaScript workspace builds, while pnpm
package commands, Go commands, and modules under `packages/tooling/` are
implementation leaves. Their `:raw` commands are kept
for Task and CI composition rather than normal developer use.

The self-hosted Web product ships only through the Docker image. Task launches
the Go Core binary directly for Web development; there is no Node.js server
adapter. The Core binary embeds both the main Web UI and Player UI.

## Commit style

This repo uses [Conventional Commits](https://www.conventionalcommits.org/).
Typical shapes:

```
feat(ui): add dark-mode toggle to settings page
fix(core): resume m3u8 downloads after process restart
refactor(extension): split options hook per card
chore(deps): bump axios from 1.14.0 to 1.15.0
```

Commits are lint-staged on commit (oxlint --fix + oxfmt --write on
staged files). Type checks run via `turbo type:check`.

## Pull requests

- Open PRs against the `master` branch.
- Keep each PR focused — one feature / fix per PR if possible.
- Include a short "why" in the description; the "what" is in the diff.
- If the change is user-visible, a line in the PR description that would
  fit in a release note is appreciated.

Thanks for contributing! 🚀
