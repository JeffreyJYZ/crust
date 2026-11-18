# Focus: every GUI-launching entry point, and where its restore is unreachable

Read from source only; no suite was run (each takes the screen, which is the defect).

## The inventory

`captures` = calls `captureFrontmost()`; `restores` = calls `restoreFocus(frontmost)`.
"Skip paths" are the exits where the restore provably does not run.

| Entry point | Captures | Restores | Skip paths |
| --- | --- | --- | --- |
| `e2e.ts` | L156, top level | `finally` L168 | signal (SIGINT/TERM/HUP), uncaught rejection outside `main` |
| `e2e-parity.ts` | L153, top level | `finally` L163 | signal |
| `e2e-dev.ts` | L112, top level | `finally` L124 | signal |
| `e2e-native.ts` | L154, top level | `finally` L165 | signal |
| `e2e-notes.ts` | L41 | `finally` L56 | signal; `clearSurvivors` L45 and `mkdtemp` L49 sit **before** `try` L50 |
| `e2e-window.ts` | L23 | `finally` L34 | signal; `mkdtemp` L24 before `try` L26 |
| `e2e-single.ts` | L27 | `finally` L41 | signal; `mkdtemp` L32 before `try` L33 |
| `e2e-dogear.ts` | L25 | `finally` L38 | signal; `mkdtemp` L26 before `try` L30 |
| `e2e-dev-react.ts` | L28 | `finally` L42 | signal; `mkdtemp` L29 before `try` L30 |
| `e2e-dev-binary.ts` | L39 | `finally` L164 | signal; ~60 lines (`spawnSync`, `mkdtemp` L88, `mkdir`/`writeFile`, `clearSurvivors` L100) before `try` L102 |
| `e2e-notify.ts` | L62 | `finally` L188 | signal; `mkdir(cache)` + `mkdtemp` L77 before `try` L82 |
| `e2e-capability.ts` | L27 | `finally` L98 | signal only (nothing between capture and `try` L30) |
| `first-run.ts` | L76 | `finally` L134 | signal; `mkdtemp` L78 before `try` L81 |
| `butter-sweep.test.ts` | L53 | `finally` L74 | signal; child exits before restore, which is the correct order |
| `demo.ts` | **none** | **none** | launches a real `crust dev` window (L23) and exits with it — every path |
| `probe-tray.ts` | **none** | **none** | starts a real AppKit app + status bar, restores nothing |
| `probe-notif.sh` | L10 | last line only | `exit 1` at the missing-binary guard (L17), and no `trap` for kill/Ctrl-C |
| `probe-vite.sh` | L7 | last line only | no `trap`; a kill or Ctrl-C skips it |

Not macOS-GUI, listed so the set is closed: `e2e-package.ts` (mounts with `-nobrowse -noautoopen`,
so no focus theft, but it captures nothing), `e2e-package-nsis.ts` (win32 guard L19),
`e2e-appimage.ts` (linux guard L104), `e2e-linux.ts`, `linux-smoke.ts`, `windows-smoke.ts`,
`verify-package.ts`, `verify-cellar.ts`, `release.ts`, `build-standalone.ts`.

## What the shapes actually mean

- **`process.exit` is not the problem here.** Every suite already uses the safe shape —
  `process.exit(await main())`, where `main`'s own `finally` runs before the value is returned —
  or `let code; try { … } finally { restore }` then `process.exit(code)` (`e2e.ts` L156-170,
  `e2e-parity` L153-165, `e2e-dev` L112-126, `e2e-native` L154-167). No suite has
  `try { process.exit(…) } finally { … }`. The unsafe shape is absent, not present.
- **No entry point installs a signal or exit handler.** `rg 'process\.on\('` over `scripts/`
  returns nothing. So Ctrl-C, a CI timeout, a `kill`, a closed terminal or the harness being
  stopped leaves the test window frontmost — and that is the leak the owner sees, because it is
  the one path nobody rehearses.
- **The pre-`try` block is the second real leak.** In eight suites the capture is followed by
  scratch setup (`mkdtemp`, `mkdir`, `clearSurvivors`) that is *outside* the `try`, so a throw
  there (a full `/var/folders`, a permission error, a wedged `pgrep`) skips the restore entirely.
- **The ordering question (brief item 4) is answered correctly everywhere it matters.**
  `e2e-window` L31, `e2e-single` L38, `e2e-dogear` L35, `e2e-dev-react` L39, `e2e-notify` L185,
  `e2e-dev-binary` L161 and `butter-sweep.test.ts` L74 all clear/await the child **before**
  restoring. The exception is the four top-level-capture suites (`e2e.ts`, `e2e-parity`,
  `e2e-dev`, `e2e-native`): they restore in `finally` and only clear survivors in the `catch`,
  so on a path where the app survives, `open -a` can be undone by that window re-activating.
- **`restoreFocus` cannot detect a poisoned target.** `harness/focus.ts` L65 runs
  `open -a <name>` with no guard, so a suite that captured a *previous* suite's test window
  restores that window's app — the cascade, reproduced faithfully. This is why the owner sees
  every later suite restore to the wrong app.
- **The guard test does not cover this.** `harness/focus.test.ts` L93-115 lists 12 callers
  (`e2e-capability.ts` is missing) and only asserts the *text* contains
  `captureFrontmost()` and `restoreFocus(frontmost)`. A capture in an unreachable place passes.

## Ranked fix

1. **One installer in `scripts/harness/focus.ts`, called once per entry point.** It captures at
   module load (before any GUI), then registers `SIGINT`, `SIGTERM`, `SIGHUP`,
   `uncaughtException`, `unhandledRejection` and `process.on("exit")` — the signal paths run a
   synchronous restore (`Bun.spawnSync(["open","-a",saved])`), because an async `finally` cannot
   run after a signal. This closes the signal leak for all 12 suites at once and is the smallest
   change that makes "every exit path restores" true. Each suite then drops its hand-rolled
   capture/finally pair.
2. **Move the capture above the scratch setup**, or let the installer own it, so no throw can
   sit between the capture and the `try`. Same commit, no behaviour change otherwise.
3. **Make `restoreFocus` refuse a poisoned target**: skip a name that matches our own test apps
   (`Hello crust`, `Notify e2e`, the dogear/single/window scratch bundles) or a process with no
   window, and fall back to the terminal. That turns a cascade into a single leak.
4. **`trap 'open -a "${FRONTMOST:-Ghostty}"' EXIT INT TERM`** in `probe-notif.sh` and
   `probe-vite.sh`, and move `probe-notif.sh`'s capture above the missing-binary `exit 1`.
5. **Optional, not required:** pass the run's original app down as `CRUST_FRONTMOST` so an outer
   runner wins over a per-suite capture. Per-suite capture is sufficient *once every path
   restores* — and today it is not, so this is a second line of defence, not the fix.
6. **Extend `harness/focus.test.ts`**: add `e2e-capability.ts` to `CALLERS`, and assert the
   signal registration exists rather than only that the two calls appear in the text.
