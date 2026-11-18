# Lane 4 — docs truth

Field: behavioural claims on `site/app/docs/**` checked against `src/`. Only claims a reader would
act on are listed. Already-pinned pages (`parity`, `config`) are left to `scripts/docs-reference.test.ts`.

Method: `rg` with explicit paths. Every finding quotes the page line and the code line. Ranked by how
badly a reader is misled, not by edit size.

## 1. The pump slice: docs say 0.25 ms, the shim runs 4 ms

`site/app/docs/design/page.mdx:39-45`:

> The Cocoa loop is pumped from JavaScript in **0.25 ms slices on a 16 ms timer** …
> 0.25 ms and 0.5 ms both delivered 186 of 187 ticks, 1 ms reached 96.8%, 4 ms only 82.4%.
> A 4 ms slice is _worse than not pumping at all_.

`site/app/docs/evidence/page.mdx:13` repeats it:

> a 0.25 ms slice delivered 186 of 187 ticks (99.5%); 4 ms delivered 82.4%, worse than not pumping
> at all (184 of 187)

`src/platform/darwin/shim/50_app.c:86,90-91,103`:

```c
if (!app) return CFRunLoopRunInMode(mode, 0.004, 0);
deadline = ... sel_registerName("dateByAddingTimeInterval:"), 0.004);
return CFRunLoopRunInMode(mode, 0.002, 0);
```

Even the comment above the function (`50_app.c:72`) says "one 0.25 ms slice" while passing `0.004`.
`0.004 s` is 4 ms, `0.002 s` is 2 ms; nothing in the shipped shim passes 0.00025 s. The docs'
central claim is that 4 ms is worse than not pumping, yet that is the value in the code.

Wrong: both doc pages (or the code regressed after the measurement). The reader is told the run loop
is tuned to a value it does not use. `PUMP_INTERVAL_MS = 16` (`src/app-types.ts:95`) is correct; only
the slice is wrong.

Command: `rg -n '0\.004|0\.002|0\.25' src/platform/darwin/shim/50_app.c`

## 2. The API reference's `app.on` signature omits four events that exist

`site/app/docs/reference/api/page.mdx:44`:

> `on(event: "ready" | "window-all-closed", listener: () => void | Promise<void>): this`

`src/app-types.ts:47-48`:

```ts
export type AppEvent =
	"ready" | "window-all-closed" | "activate" | "before-quit" | "will-quit" | "reopen";
```

`src/app.ts:106`: `on(event: AppEvent, listener: AppListener): this`

The same doc set already documents the four extra events — `site/app/docs/guides/lifecycle/page.mdx:8-13`
shows `app.on("activate" | "before-quit" | "will-quit" | "reopen")`. So the reference page is stale
against both the code and its own guide. A developer reading the signature concludes those events are
not available through `app.on` and reaches for a workaround that is not needed.

Command: `rg -n 'on\(|AppEvent' src/app.ts src/app-types.ts`

## 3. The logging guide teaches a level set and a file policy the plugin does not have

`site/app/docs/guides/logging/page.mdx:18,28,51`:

> `| level | error, warn, info or debug |`
> `level` is not one of the four
> The file itself is unbounded and is the record that survives a restart.

`src/plugins/logging.ts:14,23,26,128-129`:

```ts
export type LogLevel = "trace" | "error" | "warn" | "info" | "debug";
export const ROTATE_BYTES = 1024 * 1024;
export const ROTATED_NAME = "app.log.1";
if (size < ROTATE_BYTES) return undefined;
await rename(file, archive);
```

There are five levels, not four; `trace` is silently missing from the guide. The file rotates at 1 MiB
into `app.log.1`, so "unbounded" is false. The api-app reference gets both right
(`site/app/docs/reference/api-app/page.mdx:34`: five levels, "rotated … at the 1 MiB threshold"),
so the two doc pages contradict each other.

Command: `rg -n 'LogLevel|ROTATE_BYTES|ROTATED_NAME|size < ROTATE' src/plugins/logging.ts`

## Lower-ranked, worth a fix but less likely to mislead

- Both logging pages omit the real `logging.configure` command — `src/plugins/logging.ts:143-160`
  defines it and `src/plugins/logging-configure.test.ts` calls it; api-app:27-36 and the guide's
  command sections never name it. A page can invoke an undocumented command.
  Command: `rg -n 'configure:' src/plugins/logging.ts`
- `site/app/docs/design/page.mdx:66,102` says a new platform implements "`Platform` — five methods —
  and nothing more". `Platform` now also has optional `windowLabels?()` and `lifecycle?()`
  (`src/app-types.ts:38,44`), and darwin supplies the latter (`src/platform/darwin/lifecycle.ts`).
  "Nothing more" no longer describes a full port. Command: `rg -n 'lifecycle\?|windowLabels\?' src/app-types.ts`
- `site/app/docs/reference/cli/page.mdx:55` lists `crust doctor` checks in order but omits the
  `source` (known-fatal traps) checks pushed at `src/cli/doctor.ts:76-78`, between `window` and
  `assets`. A reader cannot account for those lines in real output.
  Command: `rg -n 'sourceSection' src/cli/doctor.ts`
- `site/app/docs/guides/network/page.mdx:30` and `:36` are the same paragraph twice; cosmetic,
  not a truth defect, recorded only so it is not re-reported as drift.

## Checked and found accurate

`45000 + hash % 4000` port (`reference/config:127`), `WINDOW_COMMANDS` count 26
(`reference/api:74`), `corePlugins` membership (`reference/api:72`), `MAX_BODY_BYTES` 2 MiB
(`reference/errors:17`), shell rings 500/256 and positioner's five placements, `typedHost`/`typedClient`
exports, `deepLink` export, and `requires: "NSRunningApplication"` for a plugin with no adapter
(`reference/api-app:61`) versus `requires: "single-instance"` for a skipped launch
(`guides/single-instance:52-53`) — both correct, different paths.
