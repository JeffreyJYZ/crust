# The platform singleton leaks between test files

```
bun test src/platform/windows                     → 314 pass, 0 fail
bun test src/platform/windows/window-adapter.test.ts → 12 pass, 0 fail
bun test src/platform/windows src/platform/linux src/runtime-  → 556 pass, 1 FAIL

(fail) the Windows window adapter > create resolves a relative url against the app's own document
```

Same test, same code, three different answers depending on which files share the process. That is a
leak, not a flake: `src/platform/windows/active-platform.ts` holds the platform in a module-level
variable, `setActiveWindowsPlatform` writes it, and a test file that leaves one set changes what the
next file sees. `src/platform/linux/active-platform.ts` is the same shape.

A reviewer flagged this risk when the singleton landed ("does it leak when a test builds a platform
twice?") and the answer is now measured: yes, across files in one process.

## What to determine first

1. **Which file leaves state behind.** Run the combinations until you can name it:
   `bun test src/platform/windows/window-adapter.test.ts src/runtime-plugins-windows.test.ts`,
   then with the linux twin, then `src/runtime-dialog.test.ts`. The culprit is whichever file sets an
   active platform and does not clear it.
2. **What exactly the leaked state changes.** The failing assertion is a relative URL resolved against
   "the app's own document" — so the leak is probably a document URL or a window list from another
   file's fake, not just a non-null pointer. Say which.

## What to fix

Pick the smallest correct one and justify it:

- **Reset in teardown** — every file that sets an active platform clears it in `afterEach`. Cheap, and
  it makes the leak visible in each file rather than hidden in a global.
- **Make the seam explicit** — the registry takes the platform as a parameter instead of reading a
  singleton. Correct, and larger: `runtime.ts` is the caller, and the reason for the singleton was to
  avoid a second `createPlatform` call, not to avoid a parameter.
- **Isolate per file** — a `beforeEach` that resets the module. Weakest: it hides the design rather
  than fixing it.

**A reset that only runs in the files you touched is not a fix** — the next test file someone adds can
reintroduce it. If you choose teardown, add the assertion that catches it: a test that sets a platform,
clears it, and proves the registry then answers as if none was set.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Prove the failure before you fix it** — paste the failing command's output, then the same command
  green, then `bun run test` green.
- Do not weaken or delete the failing assertion to make it pass. It is asserting real behaviour.
- You cannot run Windows or Linux; the fakes are the only measurement.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/platform/{windows,linux}/active-platform.ts`, the test files that set an active platform, and
`src/runtime-plugins-other.ts` only if the seam changes. Nothing else.

## Prove, and paste the output

- The failing command before and after, and `bun run test`.
- `bun check`, `bun run check:lines`.

Final message under 10 lines: which file leaked, what the leaked state was, and why your fix cannot be
reintroduced by the next test file.
