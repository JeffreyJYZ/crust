# Hunt 21 — external report from perch-crust (crust 0.2.11, macOS 27.2.1 arm64, ad-hoc bundle)

Runtime observations are `measured` by the perch-crust session (automating screen captures and its
first real turn). Root causes below are `read` here against the 0.2.11 tree, and two of them differ
from the report's phrasing — flagged where they do.

## HIGH — a project with no `dev.url` restarts the backend on every non-source write, so a parked action replays each boot

- where: `src/cli/dev/runtime.ts:80`, `src/cli/ignore.ts:15-19`
- measured: writing a capture PNG inside the project restarted the backend, so parked `PERCH_SCREEN` /
  `PERCH_PROMPT` actions replayed on every boot.
- mechanism: the frontend-extension guard is gated on `options.devUrl !== undefined`. A project with no
  dev server therefore never consults `isFrontendSource`, and `watchRuntime` watches `dirname(entry)`
  recursively, so a PNG, JPEG or SVG written next to `main.ts` falls through to `restart()`. The report
  asked for a watch-ignore list; the actual defect is that the extension guard is conditional on a
  feature the project does not use.
- reachable by: any `crust dev` app without `dev.url` that writes an asset or an output file inside the
  entry's directory — a capture, a temp render, a log screenshot.
- smallest fix: consult `isFrontendSource` unconditionally (a PNG is never backend code), and add a
  `dev.ignore` string array to config for anything the extension list cannot know. Test: a `.png`
  write under the entry dir must not restart, with `dev.url` absent.

## WITHDRAWN — the page-side capture stall is the owner taking focus, not App Nap and not a crust defect

The reporter retracted this item and the owner confirmed it: while a probe runs, the human may take
focus, and WebKit then throttles the backgrounded webview. A capture at 4–6 s succeeds, a 30 s one
misses. The rule is therefore **probes stay under 15 s**, which is already the house rule, not a
framework change — no `beginActivity`, no `app.backgroundActivity`, no unthrottled-page option. The
`page.console → app.jsonl` mirror is what made the refusal diagnosable, and that is a positive.

## MEDIUM — `keychain.set` refuses silently on an ad-hoc bundle, and no doc says ad-hoc cannot use it

- where: `src/plugins/keychain.ts`
- measured: in the perch ad-hoc build, `keychain.set` never created an item (`security
  find-generic-password` exits 44); the refusal was only visible once the app caught it, and the
  workaround was a `0600` file fallback.
- mechanism: an ad-hoc signature has no application-identifier entitlement, so the Keychain driver's
  write is refused by the OS while the plugin's own contract treats a missing item as `{ found: false }`
  — a caller that does not read the refusal cannot tell "not stored yet" from "cannot store".
- reachable by: `crust build` without a Developer ID, then any `keychain.set`.
- smallest fix: a documentation section on ad-hoc builds and Keychain, plus the driver's message on
  every refusal (the report already added the last part app-side). A framework-level dev fallback is a
  separate decision, not part of this defect.

## MEDIUM — the single-instance lock cannot be isolated, so `crust dev` raises a built app instead of starting a probe

- where: `src/plugins/single-instance-lock.ts:28-35`, `lockPath` at `:43-51`
- measured: `crust dev` raised the running app even with a different `--dir` and `--config`.
- mechanism: `defaultLockDir()` is the machine-wide app-support directory and the file name is the app
  id alone, so two trees built from the same config collide by construction; neither `--dir` nor
  `--config` reaches the lock.
- reachable by: any dev or test instance started beside a built app of the same app id — exactly the
  "quit the user's app to test" step the report had to take.
- smallest fix: derive the default lock id from the project directory when a `crust dev` runtime starts,
  or add `single-instance.id` / `--instance <name>` so a caller can name its own lock. Test: two
  runtimes with the same app id and different project dirs both acquire.

## Checked and clean

- `window.capture`'s native half on darwin: `takeSnapshotWithConfiguration` is main-process and
  unaffected by occlusion; the measured misses are consistent with the page half stalling, not the
  snapshot call.
- `page.console` reaching `app.jsonl`: the mirror path is present and was what made the refusal
  diagnosable — that part of the report is confirmation, not a defect.
