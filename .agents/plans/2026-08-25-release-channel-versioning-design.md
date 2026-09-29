# Release Channel and Versioning Design

## Summary

MediaGo's manually dispatched release workflow will expose one release-channel
choice instead of the current combination of `run_mode` and
`release_channel`. The supported channels will be `test`, `beta`, and
`latest`; `alpha` will not be offered or generated.

Test builds will remain private. Their desktop outputs will live in draft
GitHub Releases and their container images will live in the private GHCR
preview package. Test versions will advance on the next unreleased SemVer core,
so a stable `3.5.0` followed by a patch test produces `3.5.1-test.0`.

## Goals

- Replace the contradictory public inputs `run_mode` and `release_channel`
  with a single `release_channel` choice.
- Support exactly three new-release channels: `test`, `beta`, and `latest`.
- Keep all downloadable test outputs private.
- Derive test versions from the latest stable version and a per-core test
  counter, starting at zero.
- Use `version_increment` to select the target core consistently for test,
  beta, and direct latest releases.
- Preserve safe reruns, serialization, and official version commits.

## Non-goals

- Migrating or republishing historical releases.
- Deleting historical `alpha` tags if any exist.
- Making test releases or preview images public.
- Replacing the existing Electron or Docker build implementations.
- Automatically upgrading a private test installation to beta or latest.

## Current Behavior and Problems

The workflow currently exposes both `run_mode=test|release` and
`release_channel=alpha|beta|latest`. In test mode the channel is ignored, so
the UI permits combinations that do not carry meaningful semantics.

Test version planning currently appends the global GitHub Actions run number to
the committed product-version core. With a committed version of `3.5.0`, a
test build therefore looks like `3.5.0-test.<global-run-number>`. It neither
advances to the next patch core nor starts the test counter at zero.

Official releases use Git tags as durable version history, while private test
builds use opaque technical tags and draft Releases. Consequently, the current
version planner has no durable per-core test-version history from which to
calculate `test.N`.

## Considered Approaches

### Private draft Releases as the test-version ledger (selected)

Authenticated release preparation reads draft Release records and reserves a
new draft before builds begin. The draft title stores the private SemVer value,
while the associated Git tag remains an opaque technical identifier such as
`test-run-<run-id>`.

This preserves the current privacy model, provides durable numbering, and
allows workflow reruns to recover the original version. It requires explicit
reservation and draft-query logic but uses infrastructure that the release
workflow already owns.

### Public SemVer test tags

Publishing `v3.5.1-test.0` tags would make numbering simple because the existing
tag scanner could calculate the next value. Tags in a public repository are
public even when the associated Release is a draft, so this does not satisfy
the private-test requirement.

### GitHub run numbers or repository variables

The global run number is collision-free but cannot restart at `.0` for each
SemVer core. A mutable repository variable could implement a counter, but it
would require reset, locking, failure recovery, and reconciliation logic. It is
less reliable than using the existing serialized release records.

## Workflow Interface

The `workflow_dispatch` interface will contain these inputs:

| Input               | Choices                    | Default | Meaning                                       |
| ------------------- | -------------------------- | ------- | --------------------------------------------- |
| `build_target`      | `all`, `desktop`, `docker` | `all`   | Workers to run                                |
| `release_channel`   | `test`, `beta`, `latest`   | `test`  | Version and publication policy                |
| `version_increment` | `patch`, `minor`, `major`  | `patch` | Target core relative to the latest stable tag |

`run_mode` will no longer be user-selectable. The top-level workflow will
derive the existing internal mode for reusable workflows:

| Channel  | Internal mode |
| -------- | ------------- |
| `test`   | `test`        |
| `beta`   | `release`     |
| `latest` | `release`     |

Keeping this internal adapter limits the change to release orchestration. The
Electron and Docker reusable workflows can retain their current test-versus-
release branches while their channel validation is narrowed to the new public
contract.

The run name will include the channel, build target, and increment so operators
can verify the selected release line before dispatch.

## Version Model

### Sources of version state

The planner will receive normalized version records from three sources:

1. Official Git tags provide stable and `beta.N` versions.
2. Authenticated draft Releases owned by the test workflow provide `test.N`
   versions through a strict reservation record.
3. The committed product version provides the authoritative active official
   beta core, or official recovery state when a stable version commit exists
   but its release/tag is unfinished.

Only drafts whose tag matches `test-run-<run-id>` and whose body contains the
exact reservation schema defined below may contribute test versions. Unrelated
drafts are ignored.

The committed product version remains authoritative for official release
recovery, but it is not the counter for private test builds.

### Target core and official recovery

The latest stable version is the greatest official tag without a prerelease
suffix. In the normal case, the requested target core is the result of applying
`version_increment` to that stable version. For example, stable `3.5.0` maps
patch to `3.5.1`, minor to `3.6.0`, and major to `4.0.0`.

Private test drafts never select or lock the official release line. Each test
run uses the requested target core and advances only that core's test counter.
This permits a patch test after an abandoned minor test without deleting
history, and it makes the input's meaning consistent across runs.

Official release planning adds one override. If the committed product version
is newer than the latest completed stable tag, that committed version is
authoritative for official channels:

- A committed `X.Y.Z-beta.N` locks beta/latest to core `X.Y.Z`, whether that
  beta publication is completed or unfinished. Beta advances from the highest
  official beta tag on that core; latest promotes the same core.
- A committed stable `X.Y.Z` without its completed tag/Release is resumed by
  latest exactly as written; it must not be bumped again.
- The core implied by `version_increment` must match the committed pending
  core. A mismatch fails before mutation and tells the operator which increment
  to select.

When there is no locked official state, beta and latest can start directly
from the requested core even if no private test draft exists. Historical
prereleases at or below the latest stable core do not affect calculation.

The workflow will not generate alpha versions. A historical alpha tag at or
below the latest stable version is harmless. An unsupported official
prerelease on a future requested core must cause an explicit error so it cannot
be silently bypassed.

### Channel calculations

For requested or recovered target core `X.Y.Z`:

- `test`: choose one greater than the highest recognized `X.Y.Z-test.N`, or
  choose zero if none exists.
- `beta`: choose one greater than the highest official `X.Y.Z-beta.N`, or
  choose zero if none exists.
- `latest`: produce stable `X.Y.Z`, unless it is resuming an already committed
  stable version with that core.

The expected progression after stable `3.5.0` with a patch increment is:

```text
3.5.1-test.0
3.5.1-test.1
3.5.1-beta.0
3.5.1-beta.1
3.5.1
```

This is a release-creation sequence, not one monotonically increasing SemVer
stream. SemVer compares `3.5.1-beta.0` below `3.5.1-test.1` because prerelease
identifiers are compared lexically. That does not control promotion here:

- Private test builds are an isolated, manually downloaded channel and do not
  automatically update to beta or latest.
- Moving from an installed test build to beta/latest requires a manual install
  or reinstall; downgrade-style automatic transitions are unsupported.
- Beta and latest retain their normal official update path, where beta.N
  advances within beta and stable `X.Y.Z` outranks every prerelease on that
  core.

Test builds may continue on the same requested core after beta begins; the next
beta build still advances only the beta counter. Private test drafts never
override the committed official beta core.

### Official state transitions

This table makes core selection explicit when stable `3.5.0` is the latest
completed stable tag:

| Committed product version            | Requested channel/increment | Result                                              |
| ------------------------------------ | --------------------------- | --------------------------------------------------- |
| `3.5.0`                              | test/patch                  | next `3.5.1-test.N` draft                           |
| `3.5.0`                              | beta/patch                  | `3.5.1-beta.0` and official version commit          |
| `3.5.0`                              | latest/patch                | direct `3.5.1` official version commit              |
| `3.5.1-beta.0`                       | beta/patch                  | next official `3.5.1-beta.N`                        |
| `3.5.1-beta.0`                       | latest/patch                | `3.5.1`                                             |
| `3.6.0-beta.0`                       | beta/minor                  | next official `3.6.0-beta.N`                        |
| `3.6.0-beta.0`                       | latest/minor                | `3.6.0`                                             |
| `3.6.0-beta.0`                       | beta or latest/patch        | fail: increment conflicts with locked official core |
| `3.5.1` without completed stable tag | latest/patch                | resume `3.5.1` and its owned commit                 |
| `3.5.1` with completed stable tag    | any/patch                   | start from new stable base and target `3.5.2`       |

A completed beta does not close its official line; only publishing the matching
stable version does. Starting another official core while a committed beta core
is locked is unsupported. Test builds remain free to select a different core
because they do not mutate official product state.

### Product-version writes

- `test` applies its calculated version only to the checked-out build tree. It
  never commits or pushes the product-version file.
- `beta` and `latest` retain the current official flow: update the product
  version when needed, commit it with release ownership trailers, and build the
  verified committed source.
- Releasing `latest` from a committed locked beta core removes the prerelease
  suffix instead of bumping the core again.
- Releasing `latest` after its stable version commit was pushed but before its
  tag/Release completed reuses that exact commit and version.

## Private Test Reservation and Reruns

The prepare job must reserve a test version before starting desktop or Docker
builds.

For a new workflow run:

1. Resolve `origin/master` and require the dispatch source SHA to equal its
   current commit before creating any new reservation.
2. Fetch official tags and authenticated draft Releases.
3. Apply `version_increment` to the latest stable tag to select the target
   core.
4. Allocate the next `test.N` value.
5. Create the opaque technical tag and private draft in one GitHub Create
   Release API request using `tag_name=test-run-<GITHUB_RUN_ID>`,
   `target_commitish=<source-sha>`, `draft=true`, and `prerelease=true`. The
   workflow must not push the technical tag separately before this request.
6. Store the calculated SemVer in the draft title and write the exact ownership
   marker below into the draft body.
7. Pass the Release ID, reserved version, and source SHA to all requested
   workers.

The ownership marker is a single HTML comment containing compact JSON:

```text
<!-- mediago-test-reservation:{"schema":1,"runId":"123","sourceSha":"<40-hex-sha>","buildTarget":"all","version":"3.5.1-test.0"} -->
```

The parser requires exactly one marker, schema `1`, a decimal positive run ID,
a full lowercase SHA, one of the three build targets, and a SemVer test version.
The draft title must equal the marker's version, its `tag_name` must equal
`test-run-<runId>`, its `target_commitish` must resolve to `sourceSha`, and the
record must remain both draft and prerelease.

For a workflow rerun:

1. Query releases by the deterministic technical tag and list all owned draft
   reservations used for counter calculation.
2. If the matching draft exists, validate its complete marker, source SHA, and
   build target, then reuse its SemVer.
3. If neither draft nor technical tag exists, allocate and create the
   reservation only when the original source SHA still equals current
   `origin/master`. If `master` has advanced, fail and require a new dispatch
   instead of reconstructing a reservation against a stale source.
4. If the technical tag exists without a draft, validate that it resolves to
   the requested source, allocate against the current durable draft ledger, and
   create the missing draft against that existing tag without asking GitHub to
   create or move a ref. This recovery may use an older source because the tag
   already fixes its identity. A tag without a draft never reserves a test
   number.
5. If a draft exists without a materialized Git ref, treat the draft as the
   canonical reservation and address future asset operations by Release ID.
6. After a timeout or ambiguous API response, query the deterministic tag
   before retrying the create request.
7. Reject duplicate drafts, wrong-source tags, malformed owned markers, changed
   build targets, and any published record in the owned namespace.

This workflow deliberately does not use a PAT or GitHub App credential with
`workflows:write`. The standard `GITHUB_TOKEN` has the minimum repository
contents permission required by the release flow. If `master` advances between
the preflight check and a new Create Release request, an authorization or ref-
creation failure is reconciled by querying the deterministic tag and draft
once. If neither was created, the run fails with an explicit stale-source
message. It never retries against the newer SHA, changes the reservation's
source, or requests a broader credential. Existing valid drafts and tags remain
rerunnable because their identity was already materialized.

The existing global `mediago-release` concurrency group serializes allocation.
A failed or cancelled run retains its number once the draft exists; numbers are
never recycled. It advances the counter only for its selected core and does not
block patch, minor, or major test lines on other cores. This makes every
per-core sequence monotonic and removes race-dependent reuse.

The opaque technical Git tag is repository-visible, as it is today, but it
does not contain the private SemVer. GitHub exposes draft Release listings only
to users with push access, so the title, marker, assets, and release page remain
collaborator-only. The design relies on GitHub's single Create Release endpoint
to create a new tag from `target_commitish` together with the draft record.

## Publication Behavior

### Test

- The reserved GitHub Release remains a draft and is never promoted.
- Each desktop matrix job packages its complete output as one staging archive
  and uploads it directly to the owned draft by Release ID using the GitHub
  Release Assets API. The deterministic asset name includes the run ID and
  runner, for example `test-stage-123-macos-15.zip`, so the two macOS jobs can
  both carry their same-named updater manifests without overwriting each
  other. Uploads use clobber semantics after validating the reservation.
- Test desktop jobs must not use `actions/upload-artifact`, because Actions
  artifacts in a public repository are downloadable by anyone with repository
  read access.
- After all four matrix legs succeed, one test finalizer downloads exactly the
  four expected staging archives from that Release ID into separate runner
  directories. It invokes the existing desktop collection logic to merge the
  two macOS manifests, normalize filenames, and validate the complete Windows,
  macOS Intel, macOS Apple Silicon, and Linux inventory before uploading the
  final assets to the same draft.
- Final uploads use idempotent clobber semantics. The finalizer also uploads a
  small inventory record containing the reservation identity plus every final
  asset name and SHA-256 digest, then verifies the remote inventory before
  deleting any stage.
- The finalizer deletes staging assets only after every normalized final asset
  and the inventory have uploaded and verified successfully. A partial matrix
  or failed finalizer therefore leaves recoverable private staging data; a
  rerun may reuse successful stages and replaces deterministic filenames
  safely. If cleanup fails after final verification, a rerun recognizes the
  complete inventory, skips rebuilding already verified assets, and retries
  deletion of any remaining stages. Staging cleanup is idempotent.
- Docker images publish only to the private `mediago-preview` GHCR package.
- The private image tag is the reserved version, for example
  `3.5.1-test.0`; no Docker Hub image is published.
- Docker-only runs keep the draft reservation without desktop assets and update
  its body/summary with the private image reference and digest.
- Application telemetry and official signing/publication policies retain their
  current test-mode behavior.
- Test builds have no automatic updater feed. The `test` channel embedded in
  package metadata identifies the build but does not make a private draft
  discoverable by unauthenticated clients.

### Beta

- Create the official `vX.Y.Z-beta.N` tag.
- Publish a GitHub prerelease.
- Publish versioned release images according to the existing official Docker
  policy.
- Do not mark the Release or image as `latest`.

### Latest

- Create the official `vX.Y.Z` tag.
- Publish a non-prerelease GitHub Release and mark it latest.
- Publish the versioned image plus the `latest` image tag.

### Build-target completion matrix

Publication depends on `build_target`; a channel does not imply that both
surfaces were requested:

| Channel         | Target    | Completion state                                                         |
| --------------- | --------- | ------------------------------------------------------------------------ |
| `test`          | `desktop` | Owned private draft with all desktop assets; no image                    |
| `test`          | `docker`  | Owned private draft record plus private preview image; no desktop assets |
| `test`          | `all`     | Owned private draft with desktop assets plus private preview image       |
| `beta`/`latest` | `desktop` | Official tag and GitHub Release with desktop assets; no image            |
| `beta`/`latest` | `docker`  | Official images and annotated version tag; no GitHub Release             |
| `beta`/`latest` | `all`     | Official images plus one official GitHub Release/tag with desktop assets |

For test targets, the reservation exists before workers run and is the sole
completion/retry record. For official desktop/all targets, existing unfinished
draft/tag recovery remains authoritative. For official Docker-only targets,
the existing release ownership trailers and final annotated tag remain the
completion record. A rerun must use the same target and source in every row.

## Component Boundaries

### Pure version planner

`scripts/release-version/` remains responsible only for parsing normalized
version records, selecting the requested or recovered core, and calculating the
next version.
It must not call GitHub APIs. Its input contract will distinguish official
versions from private test versions, and its result will expose whether the
version starts normally or resumes committed official state.

### Release workflow adapter

`scripts/ci/release-workflow.ts` will own Git/GitHub discovery, test-draft
reservation and recovery, channel-to-mode derivation, source selection, and
publication policy. It will normalize external state before calling the pure
planner.

### Reusable build workflows

The Electron and Docker workflow scripts will validate the derived mode,
channel, version shape, and source SHA. They consume the resolved version but
do not calculate it.

The Electron reusable workflow needs a private test-upload path with the
minimum contents-write permission required for direct draft asset uploads. Its
test matrix receives the owned Release ID, produces one uniquely named staging
archive per runner, and never creates an Actions artifact. A top-level test
finalizer retrieves those four private assets by Release ID and feeds their
separate directories to the existing collector before replacing them with the
normalized release assets.

Official builds keep separate read-only matrix jobs and the existing Actions
artifact handoff because those outputs are intended for public publication.
Shared build steps may be factored to avoid duplicating commands, but test and
official job permission boundaries must remain explicit.

This keeps version policy testable without network access and keeps GitHub
state handling in one orchestration boundary.

## Validation and Failure Handling

The workflow must fail before expensive builds when any of these conditions is
present:

- The workflow was dispatched from a ref other than `master`.
- An official run does not use current `origin/master` under the existing
  recovery rules.
- A new test reservation has no existing draft or tag and its original source
  is no longer current `origin/master`.
- A future-core official tag uses an unsupported prerelease channel.
- An official pending commit's core does not match the selected increment.
- A test reservation is duplicated, malformed, or owned by another request.
- A rerun changes source SHA or build target.
- The calculated version conflicts with an official tag or recognized draft.
- A test target attempts to publish to a public package or public Release.
- A test desktop path attempts to upload a GitHub Actions artifact.
- A test finalizer cannot find exactly one valid staging archive for each of
  the four expected runners, or the collected desktop inventory is incomplete.
- A beta or latest build does not match its committed product version.

Malformed unrelated draft Releases are ignored. Malformed drafts using the
owned `test-run-` namespace are errors because silently skipping them could
reuse a version number.

## Test Strategy

### Version-planner unit tests

Cover at least:

- `3.5.0` plus patch test produces `3.5.1-test.0`.
- Repeated tests produce `.test.1`, `.test.2`, and so on.
- Patch beta produces `3.5.1-beta.0` whether or not a patch test exists.
- Repeated betas increment only the beta counter.
- Patch latest can publish `3.5.1` directly without a test or beta.
- Latest promotes a committed locked beta core to `3.5.1` without another
  bump.
- A committed stable `3.5.1` without its completed tag is resumed as `3.5.1`,
  never bumped to `3.5.2`.
- Minor and major increments start `3.6.0-test.0` and `4.0.0-test.0`.
- Patch and minor test lines maintain independent per-core counters.
- A locked official core with a conflicting increment fails, including a
  completed `3.6.0-beta.N` followed by a patch beta/latest request.
- Duplicate versions, overflow, and unsupported future official prereleases
  fail.
- Historical prereleases at or below the stable core are ignored.
- The planner never compares test and beta as one monotonic prerelease stream.

### Release-orchestration unit tests

Cover test reservation creation, reuse on rerun, ownership validation,
duplicate/malformed reservation rejection, ambiguous API responses, tag-only
and draft-without-ref recovery, source selection, and draft upload planning.
Exercise interruption before and after the Create Release request. Verify that
test publication can never make a Release public or create a GitHub Actions
artifact. Cover the race where `master` advances after preflight: an existing
tag or draft is recovered, while a run with neither record fails without
changing source or requesting a privileged credential.

### Workflow contract tests

Verify that:

- `workflow_dispatch` exposes only `test`, `beta`, and `latest` channels.
- `run_mode` is not a user input and is derived consistently for every
  reusable workflow.
- Alpha is absent from workflow choices and new-release validation.
- Test jobs use draft/private destinations.
- Beta/latest jobs keep official tagging and committed-version requirements.
- Docker-only test runs create and retain a private draft reservation.
- Each of desktop, Docker, and all has the completion state defined in the
  matrix above for every channel.
- Test desktop jobs upload directly to the draft while official desktop jobs
  retain their existing artifact collection path.
- Test stage assets are unique across all four runners, including both macOS
  jobs. Unless a complete remote final inventory already proves a previous
  upload succeeded, the finalizer requires all four stages and merges the
  updater manifests through the existing collector. Final assets clobber
  idempotently; stages are deleted only after remote digest verification, and
  an interrupted cleanup is safely retried.

### Focused verification commands

The implementation plan will use the existing Vitest files for release,
desktop, Docker, and workflow-contract coverage, followed by `task ci:quality`
and the relevant release test subset. No real Release or package publication is
part of automated tests.

## External Platform Assumptions

The design depends on these documented GitHub behaviors:

- Draft releases are returned only to users with push access:
  <https://docs.github.com/en/rest/releases/releases>.
- The Create Release endpoint accepts a new `tag_name` plus
  `target_commitish`, and can create a draft in the same request:
  <https://docs.github.com/en/rest/releases/releases#create-a-release>.
- Workflow artifacts are downloadable by signed-in users with repository read
  access, which includes readers of a public repository:
  <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts>.
- The configurable `GITHUB_TOKEN` permission list provides repository
  `contents` permissions but no separately grantable `workflows` permission,
  so stale-source reconstruction is intentionally a safe failure instead of a
  higher-privilege fallback:
  <https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#permissions-for-the-github_token>.

## Expected File Scope

The implementation is expected to modify:

- `.github/workflows/release.yml`
- `.github/workflows/build-electron.yml`
- `.github/workflows/build-server.yml`
- `scripts/release-version/contracts.ts`
- `scripts/release-version/planning.ts`
- `scripts/release-version/execute.ts`
- `scripts/release-version/cli.ts`
- `scripts/release-version.test.ts`
- `scripts/ci/release-workflow.ts`
- `scripts/ci/release-workflow.test.ts`
- `scripts/ci/desktop-workflow.ts`
- `scripts/ci/desktop-workflow.test.ts`
- `scripts/ci/docker-workflow.ts`
- `scripts/ci/docker-workflow.test.ts`
- `scripts/ci/task-workflow-contract.test.ts`

Exact edits and test commands will be defined in the implementation plan after
this design is approved.
