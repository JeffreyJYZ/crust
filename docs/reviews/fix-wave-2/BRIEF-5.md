# Fix wave, fifth brief: the tail of the hunt

Same shared rules as `docs/reviews/fix-wave-2/BRIEF.md`. One tree, `rg`/`fd`, foreground builds,
200-line cap, never `bun fmt` without paths, only your own files, quotes over numbers.

**Hand focus back when you finish.** If anything in your run launched or activated a GUI app — a
`crust dev`, an `e2e:*`, a built bundle — capture the frontmost app *before* you start
(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`)
and restore that same app afterwards, falling back to `open -a Ghostty` only when the capture failed.

These are the findings no lane has taken yet: the MEDIUM/LOW items in `defects.md` and
`native-surface.md`, and the smaller API items.

## Lane L8 — `fix-bridge-limits`

`docs/reviews/next-wave/defects.md`:

1. **§4 MEDIUM — `keychain.list` silently drops account names over 255 bytes.** A truncation that
   looks like "no such entry" is worse than a refusal. Own: `src/plugins/keychain*.ts` and the
   darwin/windows adapters if the buffer is there.
2. **§5 LOW — `MAX_BODY_BYTES` is not enforced for chunked bodies.** `content-length` is the only
   thing checked, so `Transfer-Encoding: chunked` walks past the cap. Own: `src/bridge/server/**`.

Read the section before you start; each names the file and the reachability. Do not touch
`src/bridge/server/invoke.ts`'s capability logic — F1 and L4 own it.

Prove: a test per fix. For the chunked case, a request with no content-length that exceeds the cap is
refused with the same code the sized path returns.

## Lane L9 — `fix-native-tail`

`docs/reviews/next-wave/native-surface.md` items 4 and 5:

1. **FIFO ordering assumption in download completion tokens** — a completion that arrives out of
   order is attributed to the wrong task.
2. **A failed runtime class registration wedges the unit** — the class leaks and later registrations
   fail.

Own: `src/platform/darwin/shim/downloads/*.c` and the leak's unit. F3 closed the files it named;
re-read each before writing, and if your fix pushes a file past 200 lines, split the file rather than
trim.

Prove: the ownership tests F3 added are the harness — extend them, and show the red case first.

## Lane L10 — `fix-api-shape`

`docs/reviews/next-wave/api-design.md` items 2, 3 and 4:

1. `notImplemented()` **returns** a value while `NotImplementedError` **throws**, and the in-process
   `app.invoke` path converts neither and passes no `ctx`. One of the two forms is redundant: pick
   one, or make `app.invoke` honour both, and say which you chose.
2. The config reference omits validated `windows[].minHeight` and `windows[].material`.
3. Page errors have no public `CrustInvokeError` export or type guard; window/tray failures resolve
   `{ ok: false }` inside HTTP 200.

Own: `src/plugins/define.ts`, `src/app.ts`, `site/app/docs/reference/config/page.mdx`,
`src/bridge/client/**` for the error export. Do not change a public return shape other than by
adding to it; removing one is a breaking change and needs to be reported, not made.

Prove: type-level tests where the item is a type, behaviour tests where it is runtime, and
`bun run site:build` plus `bun run check:parity` for the config page.

## Lane L11 — `fix-hollow-covers`

`docs/reviews/next-wave/test-quality.md` finding 1's follow-up: F2 added `./src ./examples` to the gate,
which is right, but two directories still have logic and thin cover — read the report's "no test at
all" list and close the top three, in whatever order the report ranks them.

Also: `src/packaging/extension-bindings-abi.test.ts` and `src/platform/darwin/screen.test.ts` were
repaired by F8 to skip visibly; check that a skip in this repo reports as a skip and not a pass, and
if the runner cannot distinguish them, say so and propose the shape that would.

Own: the test files the report names. Do not change production code.

Prove: the three new tests each fail when the thing they name is broken — show one red, then green.
