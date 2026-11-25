# Perf 11: docs audit against shipped code

Read-only audit of `site/app/docs/guides/performance/page.mdx` and the `## Performance` / CLI
sections of `site/public/SKILL.md` at HEAD `bd26a27`. No source changed. `skill:check` proves only
the command table; every row below was read against the code or the review named in the source
column.

Verdicts: `accurate` = doc and code/review agree; `wrong` = they contradict; `undocumented` =
reachable behaviour absent from both docs; `overclaimed` = doc says more than the code delivers.

## Commands and imports

| Claim (quoted from doc) | Doc file:line | Code/review file:line | Verdict | Note |
| --- | --- | --- | --- | --- |
| "the page can call `perf.sample`" | SKILL.md:318 | `src/plugins/perf.ts:47` `sample(): PerfSample \| Refusal` | accurate | name matches |
| "`perf.frameReport`" | SKILL.md:318 | `src/plugins/perf.ts:52` `frameReport(frame: FrameStats)` | accurate | name matches |
| "`perf.overlay({ enabled })`" | SKILL.md:318,332 | `src/plugins/perf.ts:22-24,58` `OverlayArgs { enabled: boolean }`, `overlay({ enabled }: OverlayArgs = { enabled: false })` | accurate | arg shape matches |
| "`perf.sinks`" | SKILL.md:319 | `src/plugins/perf.ts:64-69` `sinks(next: Partial<Sinks> = {})` | accurate | command exists |
| "`perf.reset`" | SKILL.md:319 | `src/plugins/perf.ts:70-75` `reset()` | accurate | command exists |
| "answers `not-implemented` with `requires: \"perf plugin mounted\"`" | SKILL.md:319-320 | `src/plugins/perf.ts:20` `PERF_REQUIRES = "perf plugin mounted"`, `:32-35` `refusal()` | accurate | exact string |
| "`await crust.invoke(\"perf.overlay\", { enabled: true });`" | page.mdx:77 | `src/bridge/client/install.ts:167-170` `if (typeof command === \"string\") return call(name, command, args); return call(APP, \"invoke\", { name, args })`; `src/perf/overlay/overlay.ts:50-53` `call(\"perf\", \"overlay\", { enabled: Boolean(args[0]) })` | wrong | one-string form routes to `app.invoke` with name `"perf.overlay"`; plugin form needs `("perf","overlay",{enabled:true})` |
| "`const sample = await crust.invoke(\"perf.sample\", {});`" | page.mdx:94 | `src/bridge/client/install.ts:167-170` same split; `src/plugins/perf.ts:47` registers under plugin `perf` | wrong | same broken call form as above |
| "import { createPerfPlugin } from \"crust/plugin\"" | page.mdx:71; SKILL.md:323 | `package.json:16` `"./plugin": "./src/plugins/index.ts"`; `src/plugins/index.ts:15` re-exports barrel-system; `src/plugins/barrel-system.ts:98-103` exports `createPerfPlugin` | accurate | resolves through barrel |
| "import { mountOverlay } from \"crust/perf/overlay\"" | page.mdx:63; SKILL.md:337 | `package.json:15` `"./perf/overlay": "./src/perf/overlay/overlay.ts"`; `src/perf/overlay/overlay.ts:64` `export function mountOverlay` | accurate | subpath and symbol exist |
| "(`mountOverlay`, `MARKER`)" from `crust/perf/overlay` | SKILL.md:337 | `src/perf/overlay/overlay.ts:9` `export const MARKER = "crust-perf-overlay/v1"`, `:64` `mountOverlay`; `package.json:15` | accurate | both exported |

## CLI

| Claim (quoted from doc) | Doc file:line | Code/review file:line | Verdict | Note |
| --- | --- | --- | --- | --- |
| "`crust perf record --app <dir> --seconds 10 --out perf.json`" | SKILL.md:308 | `src/cli/perf/index.ts:12-16` `.option("--app …")`, `--seconds`, `--out`; `:68` default `perf.json` | accurate | flags and defaults match |
| "`crust perf diff before.json after.json [--tolerance 5]`" | SKILL.md:309 | `src/cli/perf/index.ts:17-18` `diff <before> <after>`, `--tolerance`; `:79` default `5` | accurate | shape and default match |
| "--format json or text on `perf record` (default text)" | absent from SKILL.md:308-309 and page.mdx | `src/cli/perf/index.ts:8,16,63-67` `--format <fmt>`, validated `text`/`json`; `:132-133` json headline | undocumented | reachable flag; USAGE prints it, neither doc page does |
| text headline format `fps=… p50=…ms p95=…ms long=… heap=…MB` | absent from SKILL.md:308 and page.mdx | `src/cli/perf/format.ts:27-33` `headline()` | undocumented | the only stdout shape of a successful text record |
| "exit 2 when nothing was drawn" | SKILL.md:308 | `src/cli/perf/record.ts:78-80` zero-frame throw, `:121-125` `return fail(...)`; `:56-59` `fail` returns `2` | accurate | also 2 for no app / bad `--seconds` / bad `--format` |
| "exit 1 when a metric regressed past the tolerance" | SKILL.md:309 | `src/cli/perf/diff.ts:105-110` `REGRESS`, `:143` `regressions.length === 0 ? 0 : 1` | accurate | exact |
| "per-field deltas with a direction per field" | SKILL.md:309 | `src/cli/perf/diff.ts:43-70` `better: "lower" \| "higher"`, `:99-103` rule column | accurate | matches |

## Sample shape

| Claim (quoted from doc) | Doc file:line | Code/review file:line | Verdict | Note |
| --- | --- | --- | --- | --- |
| "`{ frame, runtime, invoke, events }`" | SKILL.md:328 | `src/perf/sample.ts:23-35` `at`, `frame`, `runtime`, `invoke`, `events`, `log` | wrong | doc omits `at: number` (`:24`) and `log: { records, ms }` (`:34`) |
| "`{ frame: { fps, p50, p95, worst, longTasks, framesDrawn } \| null, runtime: { … }, invoke: { … } }`" | page.mdx:95 | `src/perf/sample.ts:23-35` adds `at`, `events`, `log`; `FrameStats` at `:13-21` | wrong | doc omits `events`, `at`, `log`; listed frame fields do match |
| "`frame` is `null` until a page reports one" | page.mdx:98; SKILL.md:328-329 | `src/perf/sample.ts:25` `null means no page half reported frames`; `src/plugins/perf.ts:10` same | accurate | rule itself is right |
| "so a consumer can tell \"nothing was drawn\" from \"zero frames per second\"" | page.mdx:98-99 | `src/plugins/perf.ts:10-12` "an occluded window draws zero frames and that is a different fact from \"no page half\""; `src/perf/sample.ts:14` "`framesDrawn`: Zero means nothing painted" | wrong | nothing drawn is a non-null frame with `framesDrawn === 0`; `null` means no page half at all |
| "an occluded window draws zero frames and is reported as such, never as `0 fps`" | SKILL.md:330-331 | `src/plugins/perf.ts:11-12`; `src/perf/sample.ts:5-8` | accurate | matches code contract |
| "`perf.frameReport({ fps, p50, p95, worst, longTasks, framesDrawn })`" | SKILL.md:329 | `src/perf/sample.ts:13-21` `FrameStats` fields exactly | accurate | all six fields |

## Overlay

| Claim (quoted from doc) | Doc file:line | Code/review file:line | Verdict | Note |
| --- | --- | --- | --- | --- |
| "until this runs, every perf call refuses with \"perf plugin mounted\"" | page.mdx:73 | `src/plugins/perf.ts:32-35` `refusal()` on all five commands | accurate | matches |
| "frames drawn, fps, frame-time p50/p95/worst, long tasks, runtime event-loop delay and a per-plugin invoke table" | page.mdx:80-82; SKILL.md:332-333 | `src/perf/overlay/overlay.ts:88-102` | overclaimed | `:101` `Object.keys(s.invoke).slice(0, 3)` — top three plugins, not the full table |
| "the overlay says `no frames` rather than `0 fps`" | page.mdx:86; SKILL.md:330-331 | `src/perf/overlay/overlay.ts:84-88` `` `frame    no frames (drawn ${frame.framesDrawn}, not advancing)` `` | accurate | exact readout |
| "Frame statistics come from the page's own `requestAnimationFrame` deltas" | page.mdx:81 | `src/perf/overlay/overlay.ts:67,106-110` sampler drives `frameReport` | accurate | matches |
| "runtime half reports event-loop delay, heap, invoke counts and event throughput" | page.mdx:82 | `src/perf/overlay/overlay.ts:99-102` | accurate | four rows present |
| "The panel's marker string appears zero times in a build without the capability" | page.mdx:88-89 | `docs/reviews/perf/06-overlay.md:64-69` "production absence: 1 file(s), 0 occurrences", "dev bundle is asserted to contain the marker, and the production bundle is asserted not to" | wrong | exclusion is by bundle entry, not a capability: `src/perf/overlay/overlay.ts:64-66` has no capability check and `package.json:15` exports the subpath unconditionally |
| "The overlay's code is excluded from a production build unless the capability is granted" | SKILL.md:333-334 | `src/perf/overlay/overlay.ts:64-66` `mountOverlay(options: OverlayOptions = {})`; `package.json:15` | wrong | no capability gate exists; only a build that never imports the subpath omits it (review `06-overlay.md:67-69`) |
| "it is page code with no bridge or plugin imports" | SKILL.md:337-338 | `src/perf/overlay/overlay.ts:6-7` imports `./panel.ts`, `./sampler.ts`; `src/perf/overlay/panel.ts:8` imports `./sparkline.ts` only | accurate | no bridge/plugin import |

## Numbers

| Claim (quoted from doc) | Doc file:line | Review file:line | Verdict | Note |
| --- | --- | --- | --- | --- |
| "load averages between 2 and 5" | page.mdx:10 | `09-ab.md:16` "3.74–6.17"; `05-pump.md:31` "2.39–12.76"; `10-startup.md:25` "3.12–6.97" | wrong | several cited runs are outside the stated band |
| "mean time blocked per tick: 6.84 ms → 0.78 ms" | page.mdx:22 | `05-pump.md:44` "6.841, 6.598 ms \| 2.796, 2.737 ms"; `:88` "2.818 ms \| 0.781 ms" | wrong | `0.78` belongs to the second pass whose before is `2.818`, not `6.84`; first pass ends at `2.796` |
| "ticks delivered per second: 41 → 54" | page.mdx:23 | `05-pump.md:46` "41.1, 41.3 \| 49.3, 49.6"; `:91` "49.4 / 49.0 \| 54.4 / 55.0" | wrong | same cross-pass mix; paired gains are 41→49 and 49→54 |
| "app CPU, bridge idle: 1.7% → 0.7%" | page.mdx:24 | `05-pump.md:47` "0.16 s / 1.7% \| 0.16 s / 1.7%; 0.12 s / 1.2%"; `:92` "0.7% / 0.8% \| 0.7% / 0.8%" | wrong | review verdict `05-pump.md:11-12` kills the CPU claim; both passes show flat CPU |
| "ticks per second, window occluded: ~40 → ~13" | page.mdx:25 | `05-pump.md:106` "~360 (~40/s) \| 120 (~13/s)" | accurate | exact |
| "frame p50: 22 ms → 17 ms" | page.mdx:26 | `09-ab.md:10` "p50 **17 ms** … pre-fix sources give p50 **22 ms** every run"; `:63` | accurate | exact |
| "frame p95: 24 ms → 18 ms" | page.mdx:27 | `09-ab.md:10-11` "p95 **18 ms** in all three runs; pre-fix sources give … p95 **24 ms** twice"; `:64` | accurate | exact; excludes the 34 ms load spike |
| "fps: 57.6 → 57.2 (inside the control spread)" | page.mdx:28 | `09-ab.md:56` "57.65"; `:57` "57.15"; `:65` "0.84 (after), 0.18 (before clean)" | accurate | matches the before-3/after-3 pair; review summary is ≈ −1 fps:69 |
| "interleaved arms, two control rows" | page.mdx:30 | `09-ab.md:35-36` "Order: before, after, after, before, before, after … control rows" | accurate | matches |
| "p95 delta of 6 ms is far outside a 0 ms control spread" | page.mdx:31 | `09-ab.md:12` "**6 ms** against a same-arm control spread of **0 ms**"; `:64` | accurate | exact |
| "Blocking 6.84 ms of a 16 ms budget is 28% of every second" | page.mdx:35 | `05-pump.md:44,46` 6.841 ms × 41.1/s ≈ 281 ms/s | accurate | arithmetic holds |
| "Passing `nil` as the deadline … a 0.25 ms run-loop slice keeps painting serviced" | page.mdx:36-37 | `05-pump.md:63-68` | accurate | matches the two changes |
| "A native menu still opens, a window still drags, and a capture through `window.capture` still paints" | page.mdx:38-39 | `05-pump.md:119-121` `MENU …`, `DRAG …`, `CAPTURE ok=true` | accurate | proof lines present |
| "invokes at 30/s and at 200/s — free" | page.mdx:48 | `07-page-invoke.md:3-4,50-51` | accurate | inside self-control spread |
| "a 30 Hz server-sent event stream — free at 30 Hz and at 120 Hz" | page.mdx:49 | `07-page-invoke.md:3-4,52-53` | accurate | exact |
| "webview configuration flags … each changed nothing" | page.mdx:50 | `03-renderer.md:108-109,119` | accurate | all arms labelled noise |
| "invoke round trip 5.8–6.7 µs, 0.045 ms on a reused socket" | page.mdx:51; page.mdx:109-110 | `02-hotpaths.md:67-68`; `04-parity.md:106` | accurate | both exact |
| "1 MB binary result: 40 µs p50 / 100 µs p95 to parse in the page" | page.mdx:52 | `07-page-invoke.md:91` "40 µs \| 100 µs" | accurate | exact |
| "`ipc://localhost/<cmd>` with the callback in a header" | page.mdx:108 | `04-parity.md:113` "`ipc://` POST with header-carried callback" | accurate | matches |
| "everything before the window 128; creation 318; navigation 192; total 608" | page.mdx:137-140 | `10-startup.md:72,42,43,58` | accurate | each number cited, 608 is the harness-corrected total |
| "bare AppKit program … **568 ms p50**" | page.mdx:143 | `10-startup-bare.md:31` "**TOTAL** \| **568**"; `10-startup.md:110` | accurate | exact |
| "moved that by no more than the 21 ms control spread" | page.mdx:145-146 | `10-startup-bare.md:57` "The control row spreads 21 ms"; `10-startup.md:113` | accurate | exact |
| "crust's own contribution to startup is on the order of **40 ms**" | page.mdx:148 | `10-startup.md:6` "crust adds about **72 ms** end to end"; `:5` "bare floor is 568 ms p50 (536 ms after the same subtraction)" | wrong | mixes corrected 608 with uncorrected 568; like-for-like is 608 − 536 = 72 |
| "The JavaScript prelude is 15 ms" | page.mdx:151 | `10-startup.md:120` "First crust line is 15 ms at p50" | accurate | same number, labelled differently |
| "no synchronous log or store read on the launch path" | page.mdx:151 | `10-startup.md:123-128` | accurate | both checked |
| "embedded native shim compiles in **17 ms cold / 1.3 ms warm**" | page.mdx:152 | `10-startup.md:64` "17.2 ms on a cold TinyCC cache, ~1.3 ms warm" | accurate | rounded correctly |
| "Starting it in parallel with window creation saves 8 ms, inside the noise" | page.mdx:153 | `10-startup-bare.md:71-72` "bridge bound **after window creation, before the document request** is 560 ms, 8 ms below the floor" | wrong | not in parallel; bound after create |
| "Start with the overlay and answer three questions in order:" (whole 3-item list repeated verbatim) | page.mdx:163-170 and page.mdx:173-180 | no corresponding code or review | wrong | duplicate section; one copy is dead weight |

## Counts and worst findings

Verdict counts from the five tables above: **accurate 43, wrong 14, undocumented 2, overclaimed 1**
(60 rows total).

Three worst:

1. **Cross-pass numbers presented as one before/after pair** (page.mdx:22-24): `6.84 → 0.78`,
   `41 → 54`, `1.7% → 0.7%` each splice the first pass's before onto the second pass's after.
   `05-pump.md:44-47` and `:88-92` give the real paired numbers, and `05-pump.md:11-12` explicitly
   kills the CPU claim.
2. **The two page code examples cannot reach the plugin** (page.mdx:77,94): dotted one-argument
   `crust.invoke("perf.overlay", …)` routes to `app.invoke`, not the `perf` plugin
   (`src/bridge/client/install.ts:167-170`). Copy-paste from the docs fails at runtime.
3. **Startup self-cost understated by 32 ms** (page.mdx:148): `608 − 568 = 40` compares a
   harness-corrected crust figure with an uncorrected floor; `10-startup.md:5-6` gives the like-for-like
   delta as 72 ms.

Also note for the release owner: `--format json|text` and the text headline format are user-visible
CLI surface with no mention in either doc; `skill:check` cannot catch either because both are prose
gaps, not command-table gaps.

## Docs fix evidence (branch `work/docsfix`)

All 14 `wrong` rows were corrected in `page.mdx` / `SKILL.md`; the `overclaimed` row now says the overlay
shows the three busiest plugins (`src/perf/overlay/overlay.ts:101-102`), and both `undocumented` rows are
in the CLI table and the performance page. The duplicate "Measuring your own app" list was removed.

**Invoke proof.** Throwaway script `.perf-invoke-proof.ts` in the worktree used the arity split from
`src/bridge/client/install.ts:167-170` with the command map from `src/plugins/perf.ts:42-76` and the
page adapter from `src/perf/overlay/overlay.ts:44-53`:

```
routing: plugin call: perf.sample | plugin call: perf.overlay | app.invoke: perf.sample | app.invoke: perf.overlay
correct sample keys: at,frame,runtime,invoke,events,log
correct overlay answer: {"enabled":true}
dotted sample answer: {"code":"unknown-command","name":"perf.sample"}
dotted overlay answer: {"code":"unknown-command","name":"perf.overlay"}
```

**`--app` probe.** Installed 0.2.16 `src/cli/perf/app-root.ts:18-34` resolves a directory containing
`index.html`, a project directory with `public/index.html`, and a bundle with
`Contents/Resources/public/index.html`; it refuses a bare executable and any path lacking those files:

```
.tmp-appcheck/proj => .../proj/public
.tmp-appcheck/Fake.app => .../Fake.app/Contents/Resources/public
/definitely/not/an/app => undefined
```

So the docs name the accepted directory shapes and use a project directory in the example. A built
`.app` is refused only when it has no `index.html` on disk; the blanket claim "bundles are refused" is
not in the source. The `--seconds` >1 guard failure is deliberately not documented; the durable
guarantee (no paint → exit 2, no sample) is (`src/cli/perf/record.ts:119-125`).
