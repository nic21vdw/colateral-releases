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

## Verifying a download

Every installer should have a `<installer>.sha256` file beside it on the release page, plus one `SHA256SUMS` file for the whole release. GitHub also shows a `sha256:` digest next to each asset. Compare the hash of the file you downloaded with either one; if they differ, do not install it.

Windows (PowerShell):

```powershell
Get-FileHash .\CoLateral_1.0.79_x64-setup.exe -Algorithm SHA256
Get-Content .\CoLateral_1.0.79_x64-setup.exe.sha256
```

The two hex strings must be equal (PowerShell prints upper case; case does not matter).

Mac (Terminal):

```sh
shasum -a 256 -c CoLateral_1.0.79_universal.dmg.sha256
```

It prints `OK` when the file matches. On Linux use `sha256sum -c` the same way.

### For the release owner

`node scripts/release-checksums.mjs generate <folder>` writes a `.sha256` per installer and `SHA256SUMS` into the folder that holds the built assets; upload them with the installers. `node scripts/release-checksums.mjs check` reads every published release through the API (read only) and lists any asset without a matching checksum file. Add `--from=v1.0.80` to judge only releases from that version on, since older releases were published without checksum files.

<!-- release-notes:start -->
## Release notes

Generated by `node scripts/release-notes-index.mjs` from release tags, the published update notes and CoLateral-AI change titles. Do not edit by hand.

### 1.0.79 - Nightly gauntlet fixes

_published, 2026-11-06. Source: CoLateral-AI changes since 1.0.78._

- Compare the Linux dock's height and row, not its width, in desktop parity

### 1.0.78 - Nightly gauntlet fixes

_draft, not published, 2026-11-06. Source: CoLateral-AI changes since 1.0.77._

- Open the dock's Add menu in the desktop parity check

### 1.0.77 - Nightly gauntlet fixes

_draft, not published, 2026-11-06. Source: CoLateral-AI changes since 1.0.76._

- Workspace cleanup: one Add menu, six dock controls, and the bar as the only prompt
- Mirror the Mac reduced-transparency checks into the release workflow template
- Pricing: count the 4 donor licences in the live licence counter
- Engineering pack tests in their own lane; fulfilment mail reads the central contact address
- Product roast fixes: fast release gate, engineering split, free download, ask-first agents, agent-first first run
- Cut feature creep: one prompt bar, four agent CLIs, fewer card kinds and settings, no personal tools
- Scale the Linux dock-width parity allowance with the dock's own width

### 1.0.76 - ETABS model import, Revit and masonry export, and nightly fixes

_draft, not published, 2026-11-05. Source: release notes._

- The Building Analysis Studio now imports ETABS .e2k models, and its .e2k export writes walls, floors, deck properties and storey seismic and wind forces. CoLateral SAP, ETABS and SAFE can also open their own $-backup files.
- BIM Studio can export a native Revit .rvt file through Cloud Revit and bring Revit redlines back in.
- Masonry Studio exports walls and shear walls to a .masonry14 file.
- A new Continuous Beam Studio analyses and designs continuous concrete beams.
- A new Column Interaction Studio designs concrete columns from their P-M interaction diagram to CSA A23.3 or ACI 318, with section drawing tools and DXF import.
- Arcade now has a labelled entry in the top bar, and a game that fails to launch says so instead of doing nothing.
- On the last day of offline grace, About this licence now says the licence keeps working for less than a day, instead of only that grace is nearly over. The line still names what stops after grace and the Refresh licence button that checks it now.
- When an agent writes a PowerPoint file, a deck of more than 120 slides is now refused with a message saying so, the way a Word document over its limit is, instead of being saved without its later slides. A slide with more than 80 bullets, or a text box over 4000 characters, is still saved with the extra cut, and the agent is now told what was cut so it can tell you.
- When Gmail or Outlook could not be read (rate limited, a server error, or some messages missing), the Command Centre inbox now says which account failed and why, the same way the calendar bar does, instead of showing "Nothing waiting" as if the inbox were empty. A truly empty inbox still shows "Nothing waiting".
- A Codex Cloud task that was created but took too long to report back now shows up as started, with its link, instead of as a red failure that made it look safe to send again and pay for a second copy.
- Asking the orchestrator from a second window while it is still answering now just tells that window to wait, and leaves the running session alone instead of restarting it with the second window's settings once the answer finishes.
- The Video Reel Exporter opens again on older Safari and macOS WebViews (before Safari 16.4), where it had stopped loading after the story-based clip picker arrived.
- Updating a module while the old version was still starting up, including while it was still saving its key for offline use, no longer leaves the old version running under the new version's name. The update now opens the new version's files.
- The Building Analysis Studio now refuses to run with a negative, non-numeric or out-of-range slab thickness, slab density, S(T) value, IE, Mv, accidental eccentricity or damping ratio, and names the field in the Checks tab. Before, a slab thickness of -1 could turn a building whose drift was above the limit into one shown as below it. A storey drift that comes out as no number now shows as not determined instead of passing.
- CoLateral SAP no longer opens as a blank window when its saved model is damaged or incomplete. It now opens the portal frame example, says in the status bar that the saved model could not be read and why, keeps a copy of the saved data in browser storage, and leaves the original in place until you use File > Save.
- In the Building Analysis Studio, Import Tables now refuses a joint whose X, Y or Z cell is blank or not a number, and says which row and column, instead of reading it as 0 and adding the frame down to the base. The note is shown even when other frames in the same paste were added. A frame that names a joint such as constructor or toString that is not in the joint table is now reported instead of stopping the import with an error.
- In the Code Calculators, a check against a negative, zero or missing resistance now fails instead of reading OK, so a typo such as a 7500 mm cover on a spread footing no longer shows "All checks satisfied". The spread footing now also stops with a message when the cover leaves no depth above the bars.

### 1.0.75 - Nightly gauntlet fixes

_published, 2026-10-19. Source: CoLateral-AI changes since 1.0.74._

- Stabilize preview lifecycle and native resize measurements
- Keep terminal listener within its source-size limit
- Preserve reader scroll input across delayed terminal resizes

### 1.0.74 - Nightly gauntlet fixes

_tag only. Source: CoLateral-AI changes since 1.0.70._

- Sync Model World bundle and protect saved handoff inputs
- Fix terminal resize crashes and preserve Model World tool inputs
- Read worker-cap expectations from the runner CPU sample
- Unblock desktop release verification and patch source-map-js
- Reserve Windows preview version 1.0.73 before the full stable release
- Engineering sins 1a: golden-case harness and shared non-finite verdict guard
- Keep provider refusal results fresh per call
- Record reviewed Royale camera diagnosis
- Plus 411 more changes.

### 1.0.73 - Nightly gauntlet fixes

_preview, 2026-10-14. Source: release notes._

- Resizing a terminal card no longer shows a blank band or briefly redraws output at the old size while the new size is applied.
- The usage strip no longer flickers between positions with reduced motion turned on.
- Frame design outputs now require saved confirmation of ordinary use and concurrent live/snow applicability. The snow-principal combination uses NBC 2020 companion 1.0L; unconfirmed, storage/equipment/service and alternative-roof models retain their inputs with design outputs blocked.
- Steel Beam Designer now checks shear against both existing load combinations independently of bending, and shows each demand's governing combination in the results and diagrams.
- A module you switch off, or that is revoked or removed, while it is still opening now stays closed instead of finishing the load and keeping its files available.
- Pictures in a spreadsheet now move with their cells when you insert or delete rows or columns, instead of staying behind while the data beside them shifts.
- A pack whose pack.json leaves out the optional `testedUpToAppVersion` now installs instead of being refused with `pack.minAppVersion.invalid`. A malformed value in that field is now reported as `pack.testedUpToAppVersion.invalid`.
- A canvas with a few hundred notes now opens much faster: the time grew with the square of the note count and now grows in step with it.

### 1.0.72 - Windows preview for manual testing

_preview, 2026-10-08. Source: release notes._

- Includes the frozen Arcade update and canvas/browser repair.
- Windows preview: automated gameplay is deferred to Nic. Prior failed or incomplete gameplay checks remain unverified. Stable and paid delivery stay at 1.0.68.

### 1.0.71 - Multiple AI accounts and desktop fixes

_preview, 2026-10-07. Source: release notes._

- Add multiple Claude Code accounts and choose an account for each terminal. Accounts are numbered automatically, with separate sign-ins. The same selector supports the other compatible local AI providers.
- New terminals keep their full starting size while connecting, preserving the first lines of output.
- Terminal cards and their mirrors keep updating their screen size during continuous drags.
- Mac launch panels, settings and update screens keep their theme colours and reading surfaces on older WebKit versions.
- Command plus, shifted minus and numeric keypad shortcuts work on the canvas. Spreadsheet pinch zoom follows the gesture smoothly instead of racing to its limit.
- Stopping a Mac or Linux headless agent also stops its tool processes. Agent setup skips files that cannot actually run.
- Desktop builds refuse incomplete workspace assets, and Mac release assembly checks the exact release source and matching installer files.
- When the assistant sends a spreadsheet cell or slide title in the wrong shape, it is told and the card stays as it was, instead of the cell or slide showing "[object Object]".
- Pressing Enter in a large spreadsheet no longer freezes for a moment: only the cells that changed are redrawn.
- The steel column designer no longer passes a column when the factored axial load is cleared, zero or negative; those checks and the base plate read "-% FAIL" until a positive finite load is entered. Invalid incoming loads no longer retain the sample load, and linked results remain failing when either load field is cleared.

### 1.0.70 - Licence renewal and preview recovery

_preview, 2026-10-05. Source: release notes._

- Licensed sessions renew silently when the app regains focus or connectivity. Activation keys are masked while typing.
- Preview cards show a themed loading cover and provide Retry, Open in browser and Change address when navigation fails or times out.
- Preview and supported tool cards offer Mute and Unmute. Card audio controls require support from the hosted page; external servers without that support explain why Mute is unavailable.
- Supported preview, browser and tool cards offer Sleep and Wake while retaining their place and settings. Waking reloads the page, so unsaved game progress may reset.
- Claude conversations can resume after an app update or bridge restart when their saved transcript remains available. Shared project folders resume the owning card's recorded conversation.
- A local read-only release dashboard shows recorded stage timings, blockers and publication evidence. Run it separately and open its loopback page in a Preview Card.
- Preserves the browser recovery, terminal activity and verification cleanup repairs shipped in 1.0.69.

<!-- release-notes:end -->
