# hunt-50: 50 lanes, 237 findings, what survives

50 read-only lanes, each given one area and one vague defect theme. Every report is in this directory.
This file is the sorted result and, more importantly, the part of it I checked myself.

## Totals

```
lanes          50 / 50 reported
findings       237, plus ~9 adjacent notes the lanes declined to count
duplicates     ~10, found independently by two lanes (see "convergence" below)
files          50 reports, each with file:line and a reach path
```

## Tier 1 — verified by me, in this order of what a user loses

1. **App state is not per-app.** `runtime-plugins.ts:47` builds the fs plugin as
   `createFsPlugin({ allow: fs.scope })` with no app id, and `fs-scope.ts:83` falls back to
   `defaultStateRoot("crust")`. `stronghold.ts:189-190` has the same default for its file. So a scope
   persisted by app A widens app B, and B's vault lives in A's directory. Lane 01 says it measured
   the first; lane 05 read the second. **Read, confirmed in both files.** This is the single fix that
   closes two critical reports.

2. **`accessibility.focus` blocks the pump.** Synchronous cross-process AX reads on the JS thread that
   also runs the bridge and the pump (`106_accessibility_page.c:159-179`). **Read**, mechanism is
   clear from the call path; tail latency not measured.

3. **The updater deletes its backup before the swap** and swallows a failed rollback
   (`updater-node.ts:145-155`). **Read**; not reproduced, and it is the only finding that can destroy
   an install.

## Tier 2 — high, mechanism read but not reproduced

```
seed → label      a token is bound to the page-chosen ?window= at redemption (lanes 33, 34).
                  window-create.ts:61-70 already strips a page-supplied ?window= from ABSOLUTE
                  URLs, which refutes the specific absolute-URL mechanism lane 34 gives; the
                  relative case still takes the command's label by design, so what is left is
                  "window:create lets a page pick a stronger label", not "a URL smuggles one".
token → foreign   documentBase() picks the alphabetically first http window and its origin becomes
                  the base for relative URLs, with the token already appended (lane 30), and the
                  seed 302 copies a "//host/path" pathname into Location (lane 36).
clipboard.writeImage  the page path cannot pass `instanceof Uint8Array` if the bridge serialises
                  args as JSON (lane 07). Read at clipboard-image.ts:63-64; the bridge's encoding
                  is the part I did not trace.
focus detector    isArmed() receives raw text while the rules run on stripped text, so a comment
                  quoting the fix hint disarms the check (lane 47). **Read, confirmed.**
```

## Tier 3 — the systemic themes, which matter more than any single finding

Fourteen lanes independently found the same shapes. These are framework decisions, not local bugs:

```
one global slot for N instances   find-in-page, testing eval, navigation sink, menu ids,
                                  shortcuts sink, windows tray click, macOS sleep assertion
state keyed by a reusable handle  Windows fullscreen Map<HWND>, menu tags, tray index
success reported without proof    doctor's gatekeeper check, dock.progress's mislabel,
                                  sign reporting green on ad-hoc sidecars, package "mount clear"
```

## Convergence, which is evidence of realness

Two lanes reached these separately, from different files:

```
sidecar signing       42 and 45, both also citing hunt-20/10-packaging.md — known and dropped
tray modal loop       26 and 28
seed binding          33 and 34
documentBase          16 and 30
blocking AX / popup   20, 21, 28
shared state root     01 and 05
```

## Qualify before fixing

- **`app:invoke` authorising every app command** (lane 15) is *documented* behaviour — `SKILL.md` calls
  it "the broad alias that grants every app command, which is what scaffolds ship". The defect is the
  default the scaffolds ship, not the matcher.
- **`security.capabilities: []` compiling to allow-all** (lane 44) is also documented ("absent or
  empty capabilities allows every command"). Same shape: a documented default that reads backwards.
- **No live ABI defect** (lane 24): all 115 Windows declarations match their C, but 18 are outside the
  test that compares them, so the guard — not the code — is what needs fixing.
- **`examples/vite` ships zero assets** (lane 49) is real but is an example, not the framework.

## What this hunt did not establish

No lane ran a gate or a probe; every finding is a read with a reach path. Tier 1 is confirmed by my own
reading of the exact lines. Nothing in Tier 2 or 3 has been reproduced, and each fix needs a red test
before it is believed.
