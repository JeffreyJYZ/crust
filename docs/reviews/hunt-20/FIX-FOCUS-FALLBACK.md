# The focus guard activates the wrong app instead of leaving focus alone

Reported twice by the owner: "probes still don't return focus". Two mechanisms are wrong, and both are
in `scripts/harness/guard.ts`.

## 1. The fallback is a hardcoded app

```ts
export const FALLBACK_APP = "Ghostty";
const fallback = options.fallback ?? FALLBACK_APP;
const note = (reason) => write(`focus: ${reason}; restoring ${fallback} instead\n`);
options.run(["open", "-a", target ?? fallback], …);
```

When the captured app is refused — because it is one of our own test apps, a scratch-path app, or a
process with no window — the guard **activates Ghostty**. If the human was in Brave, Zed or anything
else, that is a second theft, not a restore: the run takes their screen and hands it to a terminal they
were not using.

The refusal itself is right. The recovery is not.

## 2. The capture is per-process, so a leak poisons it

`guardFocus()` captures at the moment it is called. After one leak, the next process captures the leaked
test app, refuses it, and falls back to Ghostty — so one leak still ends with the wrong app in front.

## What to do

1. **Never activate an app the run did not observe the human using.** Order the candidates:
   - the name this process captured, when it passes the refusal test;
   - the name the **run** captured before anything launched, passed down in an environment variable
     (`CRUST_FOCUS_ORIGIN`) by `scripts/e2e.ts` — that one is by definition the human's app;
   - **nothing**. Say on stderr what happened and activate no app at all. Leaving focus where it is
     beats handing it to Ghostty.
2. Keep `FALLBACK_APP` only as an explicit opt-in (`CRUST_FOCUS_FALLBACK`), not as a default.
3. Set `CRUST_FOCUS_ORIGIN` in `scripts/e2e.ts` from its own capture and let it inherit; a suite started
   on its own has no origin and takes the "nothing" path.
4. Tests, in `scripts/harness/guard.test.ts`: a refused capture with no origin activates **nothing**; a
   refused capture with an origin activates the origin; a usable capture wins over the origin.

## Own

`scripts/harness/guard.ts`, `scripts/harness/guard.test.ts`, `scripts/e2e.ts` (the origin export only).
Another lane owns `scripts/harness/probe.ts` and the per-suite `finally` blocks — do not touch those.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Never run an e2e suite or launch a GUI app.** The test for "activates nothing" must be a fake runner,
  not a real `open`.
- Red first, both runs pasted.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- The three test cases' output, and the old behaviour they would have failed on.
- `bun test scripts/harness`, `bun check`, `bun run check:lines`.

Final message under 10 lines: what the guard does now for each of the three cases.
