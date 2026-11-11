# Cloud desktop release

`.github/workflows/desktop-release.yml` builds, signs and publishes a desktop
version with no developer machine involved. It runs on this public repository's
free runners and reads the private source through `SOURCE_DEPLOY_KEY`, the same
way `macos-release.yml` always has.

## Shipping a version

1. Merge the version cut on CoLateral-AI `main` (`node scripts/gauntlet-cut.mjs`
   plus a `docs/release-notes.md` section). The version in `tauri.conf.json`,
   `apps/desktop/package.json` and `Cargo.toml` must equal the tag.
2. Dispatch **Desktop release** with `tag` (for example `v1.0.81`) and `source`
   (the full commit SHA on CoLateral-AI `main`). A cloud session can do this
   through the GitHub MCP; the run shows `nic21vdw` as the actor.
3. When all three platform builds are green, `publish` runs on its own. Nothing
   a user downloads changes before the payload, receipt and signature checks pass.
4. After `publish` finishes, commit the `website-files-<tag>` artifact to
   CoLateral-AI as `apps/web/desktop-release.json` and
   `apps/web/update-manifest.json` (storefront check 7).

| Job | What it does |
| --- | --- |
| `preflight` | Duplicate-run guard, source is on `main`, versions agree, tag is not a stable release yet, then a draft release here |
| `windows` | NSIS installer, updater-signed; Authenticode through Azure Artifact Signing once its six secrets exist, otherwise unsigned with a warning |
| `linux` | AppImage and Debian package, updater-signed |
| `macos` | `macos-release.yml` as a reusable workflow (signed, notarised universal DMG with its parity gates) |
| `publish` | `latest.json`, payload and receipt validation, prerelease + canary record, stable record, live updater check, GitHub latest, website files |

A failed run is retried with **Re-run failed jobs**. Uploads compare hashes
with what is already on the draft, so a retry never replaces a payload.

## One-time setup (repository admin)

- `mac-release` environment: add secret `FULFILMENT_RELEASE_UPLOAD_TOKEN`
  (the value in `%LOCALAPPDATA%\CoLateral\fulfilment\release-upload-token.txt`
  on the release PC). The deploy key, updater key and Apple secrets are already
  there.
- Optional, for a signed Windows installer: the six Azure values in
  `docs/windows-cloud-signing.md`, added to `mac-release`.

Release records are promoted without native upgrade proofs, the same as
`desktop:ship` on the PC when no proofs are staged: the record says
`unqualified`, and the updater signature, payload hashes and live manifest
check still have to pass.
