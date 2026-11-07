# Proposal: ship Windows from the cloud

Status: proposal, 2026-11-06. Draft workflow: [`drafts/windows-release.yml`](./drafts/windows-release.yml).
Nothing here is active, and nothing has been created in Azure or GitHub.

## Recommendation

Build, Authenticode-sign and updater-sign the Windows installer on this public
repository's free `windows-latest` runner, with Azure Artifact Signing (the
service formerly called Trusted Signing) as the certificate. That removes the
Windows build, and the only Windows-specific key, from Nic's PC. It costs
9.99 USD/month and about 45 minutes of browser work once.

## Why the PC is needed today

| Dependency on the PC | What replaces it |
|---|---|
| Windows build runs locally (`release-desktop-local.mjs`) to avoid metered private-repo minutes | Public repo runner, free. `windows-preview.yml` already proves this build works here (1.0.73 preview) |
| Tauri updater key in `~/.tauri` | Already a secret in the `mac-release` environment here; the Mac and preview builds use it |
| No Authenticode at all: the 1.0.79 installer has an empty certificate table (checked 2026-11-06), so SmartScreen warns on every download | Azure Artifact Signing through `artifact-signing-cli`, which `apps/desktop/scripts/sign-windows.mjs` and `tauri.signed.conf.json` already call |
| Linux build in WSL | Same pattern on `ubuntu-22.04` here (follow-up, not in this draft) |
| Cut, tag, land, canary and promote steps in `desktop:ship`, plus the fulfilment upload token in `%LOCALAPPDATA%` | Phase 2: a cloud orchestrator. Out of scope for this draft |

So this draft removes Windows packaging and signing from the PC. Fully
PC-free shipping also needs phase 2 (the cut and promote steps).

## What the draft does

1. Runs the release-tooling regressions before any private source or secret.
2. Refuses to touch a published stable release.
3. Checks out CoLateral-AI at the tag with the existing deploy key and proves the
   tag names the requested SHA and version.
4. Builds the frontend, runs canvas parity, then
   `npm run tauri:build:signed`: Tauri calls `sign-windows.mjs` on the app binary
   and the installer before it writes the updater `.sig` over the signed bytes.
5. Fails unless `Get-AuthenticodeSignature` says `Valid` with a timestamp on both
   `CoLateral.exe` and the installer.
6. Writes `build-receipt-windows.json` and uploads to the existing draft release
   without replacing any asset, the same immutability rule as `macos-release.yml`.

Secrets are scoped to the steps that use them, never `GITHUB_ENV`, and live in a
new `windows-release` environment that only Nic can approve.

## What Nic has to do

Azure (about 45 minutes; full click paths in CoLateral-AI
`docs/azure-signing-setup.md`):

1. Check the Azure billing account is **Individual** and the legal name and
   address match your government ID. The certificate subject is copied from it
   and cannot be edited later.
2. In Cloud Shell, run step 1 of `azure-signing-setup.md`: creates the
   `colateralsigning` account (Basic, `eastus`) and the app registration. Save
   the tenant ID, client ID, client secret and SP object ID it prints.
3. Assign yourself **Artifact Signing Identity Verifier**, then complete the
   identity validation (ID photo plus selfie, usually minutes).
4. Create certificate profile `colateral-public-trust` (Public Trust), then assign
   the app registration **Artifact Signing Certificate Profile Signer** on it.

GitHub (`nic21vdw/colateral-releases` -> Settings -> Environments):

5. Create environment `windows-release`, add yourself as required reviewer, and
   restrict it to the `main` branch.
6. Environment variables: `AZURE_ENDPOINT` (`https://eus.codesigning.azure.net`),
   `AZURE_ACCOUNT` (`colateralsigning`), `AZURE_CERT_PROFILE`
   (`colateral-public-trust`), `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `ARTIFACT_SIGNING_CLI_VERSION` (current crate version).
7. Environment secrets: `AZURE_CLIENT_SECRET`, and copies of
   `SOURCE_DEPLOY_KEY`, `TAURI_SIGNING_PRIVATE_KEY`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `COLATERAL_GOOGLE_CLIENT_ID`,
   `COLATERAL_GOOGLE_CLIENT_SECRET` from `mac-release`. Use `gh secret set NAME
   --env windows-release --repo nic21vdw/colateral-releases` so values never
   land in shell history.

Then tell the agent to enable it: move the draft to `.github/workflows/`, pin
`artifact-signing-cli` and every action by SHA, and run it once against a new
tag as a canary.

## Risks and open points

- **Public repo, private source.** The workflow only runs on `workflow_dispatch`
  by `nic21vdw`, and the environment needs approval, so a fork PR can never reach
  the secrets. Keep it that way: never add `pull_request_target`.
- **Client secret vs OIDC.** The draft uses the client secret because
  `sign-windows.mjs` requires `AZURE_CLIENT_SECRET` today. Better: a federated
  credential (subject `repo:nic21vdw/colateral-releases:environment:windows-release`)
  with `azure/login`, which leaves no long-lived secret. That needs a small change
  to `sign-windows.mjs` to accept an existing `az` login. Recommended follow-up.
- **Two `--config` flags.** `tauri:build:signed` already passes one; Tauri 2
  merges repeated `--config`, but confirm on the first canary run.
- **SmartScreen reputation.** A new Artifact Signing certificate still starts
  with low reputation. Warnings fade with downloads; they do not vanish on day 1.
- **One publisher.** While a PC ship is mid-flight, do not dispatch this for the
  same tag. The same rule already applies to the Mac workflow.
