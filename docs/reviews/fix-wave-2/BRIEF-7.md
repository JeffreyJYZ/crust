# Fix wave, sixth brief: the four findings the lanes named and nobody closed

Read `docs/reviews/fix-wave-2/BRIEF.md` for the shared rules. One tree, `rg`/`fd`, foreground builds,
200-line cap (split, never trim), never `bun fmt` without a path list, only your own files, quotes
over numbers.

**Hand focus back when you finish** to whichever app was frontmost before you started — capture it
first, or just wrap the whole run in `probe-run -c '<command>'`, which does it for you.

Lanes: **A1**, **A2**, **A3** below. The fourth item (perf) is not a lane — see the end.

## Lane A1 — `a11y-page-tree`

`docs/reviews/next-wave/accessibility-and-i18n.md` findings 4 and 5, reported as "needs native/webview
work, not `accessibility*.ts`":

1. **There is no page-facing API into the WebView's accessibility tree.** `accessibility.elementCount`
   counts *this process's* AX children through `AXUIElementCreateApplication(getpid())`, which proves
   the window exists but says nothing about what is inside the page — so a green row cannot tell a
   screen-reader user anything.
2. **There is no DOM focus command.** Keyboard focus is window-level only: a page cannot move focus to
   an element, and an app cannot be driven by keyboard from outside.

Read `src/platform/darwin/shim/106_accessibility.c`, `src/platform/darwin/accessibility*.ts`,
`src/plugins/accessibility*.ts`, and the page side in `src/bridge/client/`.

Decide the smallest honest answer for each and implement it:

- For the tree: either expose a real walk through the platform's own AX API from a *trusted* process
  (which this is not, by default), or expose the web half properly — a command that runs in the page
  and returns the accessibility-relevant structure (`role`, `label`, focusability, reading order) for
  a subtree. The second is achievable now, verifiable in a test, and honest: it reports what the DOM
  says, and the refusal that says "this is the page's own view, not the OS's" stays.
- For focus: a page command that focuses an element by selector and reports what actually took focus,
  plus honest handling when the browser refuses (`<div>` without `tabindex`).

If you conclude either is genuinely not implementable, write the reason with the evidence that
proves it and leave the refusal naming the concept. A measured "cannot" is a result; a vague "needs
native work" is not.

Own: `src/plugins/accessibility*.ts`, `src/platform/darwin/accessibility*.ts`,
`src/platform/darwin/shim/106_accessibility*.c`, `src/bridge/client/**` if a page half is needed,
tests beside them, and the accessibility guide + reference pages.

Prove: a test per command. For the tree, assert a known page's structure comes back with a role and a
label. For focus, assert focus moved and that a refusal names the reason.

## Lane A2 — `windows-keychain-frame`

Lane W2 reported, read-only, that `src/platform/windows/shim/48_keychain.c:111,135,157,171` hold
`kc_wchar target[2048]` — 2 bytes each, so 4096 bytes of local per function, exactly the frame size at
which TinyCC's PE codegen emits `call __chkstk` instead of `sub rsp`, and nothing in that unit's link
set defines `__chkstk`.

That unit is compiled on its own (`keychain-ffi.ts` imports the source and compiles it), so the
`frame.test.ts` scanner never sees it — which is why this survived.

Read `src/platform/windows/frames.ts` and `frame.test.ts` to see the scan's shape, then:

1. **Verify the risk is real** before changing anything: write a probe that compiles
   `48_keychain.c` the way the runtime does and inspects the generated code, or print the computed
   frame size for each function. If the frame is under the limit once `func_scratch` is counted, say so
   with the number and stop.
2. If it is at or over: fix it honestly — the smallest change is usually to shrink the buffer or to
   make it a `static` (this unit is not reentrant per-call in a way that matters) — and prove the frame
   dropped.
3. **Extend the scanner to cover it**, so this cannot regress: either add `48_keychain.c` to the parts
   the frame test scans (if the unit compiles standalone, the scan needs a second entry point rather
   than joining it into `shimSource`), or add a dedicated assertion that reads that file and applies
   the same rule. Say which you chose and why.

Own: `src/platform/windows/shim/48_keychain.c`, `src/platform/windows/frames.ts`,
`src/platform/windows/frame.test.ts`, and a new test if you add one.

Prove: the frame numbers before and after (or the measured "under limit" that closes it), and the
scanner failing on a deliberately oversized local in that file.

## Lane A3 — `find-bundle`

`docs/reviews/next-wave/packaging.md` / lane L2's report: `src/cli/util.ts:105` `findAppBundle` is
naive — it takes `dist`, reads entries, and returns the first directory ending `.app`. Consequences
worth checking against the code:

- App IDs with a space or dot produce a bundle name the caller expects exactly; this returns *some*
  `.app`, which may be an older build left in `dist`.
- On Linux and Windows there is no `.app` at all, so the same call site silently yields `undefined`
  where a different artefact exists.
- An app whose `build.outDir` is not `dist` is never found.

Read every caller (`rg -n 'findAppBundle' src/`) and fix it to match what the callers actually need:
the bundle this build produced, at the path this build wrote, for the platform doing the building.
Where a caller only needs "did the build produce something", returning a stale older bundle is the
defect — assert identity, not shape.

Own: `src/cli/util.ts`, its callers under `src/cli/` and `src/packaging/`, tests beside them.

Prove: tests for a stale second bundle in `dist` (must not be chosen), a custom `outDir`, and the
non-darwin answer.

## The fourth item is not a lane

`docs/reviews/next-wave/perf.md` measured that three 200 ms synchronous handlers take 600 ms of wall
time, because the bridge runs handlers on the same thread as the pump. Fixing that needs a worker or
a second process per handler, which changes where a plugin's state lives — an architecture decision,
not a patch. It is put to the user as a written choice instead of a silent "later", and nothing in
this wave changes it.

## Final message

Under 12 lines. Bullets. What you closed, what you proved, what you measured as impossible.
