# Workflow security audit, 7 Nov 2026

Scope: the five workflows in `.github/workflows/` on `main` at b9f8ce0 (`macos-release.yml`, `windows-preview.yml`, `release-tooling.yml`, `windows-smoke.yml`, `linux-macos-smoke.yml`). Read only; no workflow was run and no release was touched.

## Summary

No critical findings. Nothing triggers on `pull_request_target`, no workflow interpolates `${{ }}` inside a `run:` script (inputs reach scripts as environment variables and are validated by regex before use), every third-party action is pinned to a full commit SHA, and no workflow uploads or downloads build artifacts between jobs, so there is no artifact to poison. A fork pull request reaches only `release-tooling.yml`, which runs fixture tests with a read-only token, no environment and no secrets.

The real exposure is inside `macos-release.yml`: Apple signing credentials are put into `GITHUB_ENV`, so every later step, including third-party npm and cargo code, can read them.

| # | Severity | Workflow | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | High | macos-release | "Configure Apple signing" writes `APPLE_CERTIFICATE`, its password, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` and the identity into `GITHUB_ENV`. Every later step inherits them: `npx next build`, `npm run test:parity` (Playwright), the reduced-transparency check, `cargo`/`tauri build`. A compromised dependency in any of those can read the Apple ID app password and the signing certificate. Masking hides them from logs, not from code. | Fixed: the six secrets are passed as `env:` only on "Check Apple signing inputs", "Sign the bridge's native modules" and "Build, sign and notarise", and `releaseToolingWorkflow.test.mjs` fails if they reach any other step or `GITHUB_ENV`. |
| 2 | Medium | macos-release | `actions/cache` restores `apps/desktop/src-tauri/target` (compiled Rust) into the job that signs and notarises, with a `restore-keys: macos-universal-` prefix, so any older cache can seed the signed build. Today only Nic-triggered workflows on `main` could write that key, so this is a hardening item, not a live hole. | Open. Fix: drop `target` from the cached paths, or drop `restore-keys` so only an exact `Cargo.lock` match is used. |
| 3 | Medium | macos-release | "Add both macOS node-pty prebuilds" runs `npm install --no-save --force` for two packages outside the lockfile, so their bytes are not integrity-pinned. They end up signed inside the shipped bundle. | Open. Fix: add both prebuilds to `apps/bridge/package-lock.json` in CoLateral-AI (optionalDependencies) and use `npm ci`. |
| 4 | Medium | macos-release | `setup-node` uses `node-version: 22` (floating) with `cache: npm` in a credentialed job; `windows-preview.yml` and `release-tooling.yml` pin `24.19.0`. | Open. Fix: pin the exact Node version. Not changed here because the Mac run for 1.0.76 is pending on this file. |
| 5 | Low | all manual | Jobs are gated on `github.actor == 'nic21vdw'`. On a re-run, `github.actor` is the person who first triggered it and `github.triggering_actor` is who pressed re-run. Only collaborators can re-run, so the gap is theoretical. | Open. Fix: also check `github.triggering_actor`. |
| 6 | Low | linux-macos-smoke | Only workflow with no actor gate. It needs write access to dispatch and uses a read-only token on public assets, so impact is a wasted runner. | Fixed in this PR: same actor gate as the other manual workflows. |
| 7 | Low | windows-preview | Uses the `mac-release` environment for its secrets (deploy key, updater key). Works, but the name hides that the Windows preview holds the updater signing key too, and environment protection rules apply to both at once. | Open. Fix: a separate `windows-preview` environment if rules ever need to differ. |
| 8 | Info | release-tooling | Runs on fork PRs with `contents: read`, `persist-credentials: false`, no environment, no secrets, 5 minute timeout. A fork can run code on a hosted runner, which is normal for public CI. | No action. |
| 9 | Info | macos-release, windows-preview | `contents: write` is set at workflow level. Both jobs upload release assets, so it is needed; each workflow has one job, so job-level scoping would not reduce anything today. | No action. |

## Checked and clean

- Pinning: every `uses:` is a 40-character SHA (`actions/checkout`, `setup-node`, `setup-python`, `actions/cache`, `dtolnay/rust-toolchain`). The tooling test already enforces this for `windows-preview.yml` and `release-tooling.yml`; `macos-release.yml` is pinned but not covered by that test.
- Checkout credentials: every checkout sets `persist-credentials: false`.
- Script injection: no `${{ }}` inside any `run:` body; `inputs.tag` and `inputs.source` are regex-checked (`^v[0-9]+\.[0-9]+\.[0-9]+$`, `^[0-9a-f]{40}$`) before checkout, and the dispatch guard refuses bad input before any network call.
- Fork reach: `windows-preview`, `macos-release` and both smoke tests are `workflow_dispatch` only. Fork PRs cannot dispatch, and the two secret-holding workflows also require a protected environment.
- Publishing: the Mac upload refuses to change a stable release, downloads and hash-compares any asset that already exists before uploading the missing ones, and never deletes.

## Not covered

Environment protection rules and branch protection are repository settings the API exposes only to admins; they were not read. Self-hosted runners are not used by this repository (`colateral-build` is where they live).
