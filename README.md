# colateral-releases
Public download host for CoLateral desktop installers. No source code: release assets only.

## Early release-tooling regressions

The public tooling regression workflow runs on Windows for tooling/workflow pull
requests, relevant main pushes and manual checks. It uses public tooling and
invented temporary Git/TOML fixtures only, with read-only permissions, no protected
environment and no release credentials. Actions are pinned to immutable commits;
the added Node and Python runtimes are pinned to exact versions.

The Windows preview runs the same gate before private source checkout, credential
checks, dependency installation or compilation:

```sh
node scripts/release-tooling-preflight.mjs
```

An additional read-only ownership gate checks the retained release before private
checkout or build. Any existing draft, retained assets or publication belongs to
its existing owner and skips every later step. The exact current workflow attempt
is identified only when no retained version exists. Rechecks before frontend,
native compilation and publication stop a concurrent owner race at the next
checkpoint. A local owner must set the existing repository's `WINDOWS_PREVIEW_HOLD`
variable to `1` before unpublished work. The workflow captures it at job start;
changes affect future jobs, not the active attempt's later checkpoints. Setting
the hold alone never authorizes overlapping work. Before starting, a local owner
must obtain completion or authorized cancellation and explicit release of any
active cloud owner for that version. Confirm cancellation/completion rather than
assuming a request stopped the process. This check cannot observe an unregistered
local process. Clearing a hold is the release owner's decision.

If another owner publishes after the last recheck, the existing executor's
immutable collision checks remain mandatory. Reuse the retained publication and
its actual download evidence rather than rebuilding or uploading a replacement.
The guard never cancels a run, writes a release or alters retained assets.

This executes the actual Git autocrlf CRLF-to-LF fixture, typed TOML comparisons,
source/tree/version/key/mode integrity checks, immutable publication collisions,
dispatch recovery checks and the early-gate workflow contract. A failure or
missing Git/Python prerequisite exits nonzero before a long build. The public
summary names the failed fixture and repair action without replaying parser input,
private source, account values, environment values or raw child diagnostics.

The newline exception remains limited to the same admitted run's unstaged regular
Cargo manifest, unchanged Git mode/index and normalized blob, and full typed TOML
equality. Staged changes, other tracked paths, changed dependencies/scalar types,
invalid UTF-8/TOML, changed source or changed updater trust remain failures. No
source edit, normalization repair or broad dirty-tree waiver is performed.
Workflow-text assertions separately normalize LF/CRLF transport and rerun the
actual checkpoint fixture with CRLF input. They still require the same checkpoint
and stage order; they do not weaken the manifest or source-integrity checks.

## Signing and delivery evidence

This manual Windows preview explicitly selects optional, unverified Authenticode.
It does not claim publisher identity or SmartScreen trust. Required Authenticode
must use its separately approved signed release path; changing the preview policy
to required fails early instead of silently producing an unsigned installer.

Updater signing is independently mandatory. The existing updater key is unchanged.
The actual installer/signature pair must pass the frozen source's updater verifier
after native build and before publication. A `.sig` file's presence, a tooling test
pass or a successful Tauri compile does not prove signature validity.

The existing build/admission receipts bind source/tree/version, the actual tooling
commit/run, manifest representation proof, parity and artifact hashes. Publication
still refuses conflicting immutable assets, reconciles uncertain writes, keeps a
manual prerelease separate from stable/paid promotion and anonymously downloads
every published asset to compare actual bytes. A published installer is not proof
of native upgrade, licence/project retention or gameplay acceptance.

## Failure recovery and limits

Use the failed gate's sanitized phase/reason and next action. Reproduce the tooling
gate with Git and Python 3.12 before retrying a build. Inspect existing release/run
receipts and retained assets before retrying publication. Never move the frozen
app source, overwrite assets, skip a signature/provenance failure or launch a
second build while the current release owner is recovering its run.

These workflow changes apply only to future runs after review and merge. They do
not modify or restart an already dispatched run. Regression tests catch the
reproduced newline/parser cases; hosted image changes, unavailable credentials,
network/storage failures, signing/notarization and real native qualification still
need their own gates and evidence. No zero-failure guarantee is made.
