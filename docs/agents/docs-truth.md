# docs-truth — traps worth keeping

- A doc page and its inline code comment can agree with each other and still both be stale against the
  value the code passes: `shim/50_app.c` comments "0.25 ms slice" and calls `CFRunLoopRunInMode(..., 0.004, ...)`.
  Check the literal, never the prose beside it.
- The `design` and `evidence` pages repeat measured numbers. When one drifts, grep both; a fix to one
  page alone leaves the claim alive elsewhere.
- Two docs disagreeing on a `requires` string is not proof of a defect: single-instance answers
  `"NSRunningApplication"` from the plugin with no adapter and `"single-instance"` from a skipped
  launch. Trace which path each page describes before calling one wrong.
- The api reference's signature tables go stale after feature work while the matching guide stays
  current: `app.on` in `reference/api` still lists two events after lifecycle added four. Diff the
  signature against the exported type, not against the guide that happens to be right.
- The `scripts/docs-reference.test.ts` truth guard pins `parity` and `config` only. A clean run of it
  says nothing about `guides/**` or the other `reference/**` pages.
- A "page describes a count or enum" is the highest-yield target: logging's guide said four levels and
  an unbounded file while the plugin has five and rotates at 1 MiB.
- Commands that prove these: `rg -n '0\.004|0\.25' src/platform/darwin/shim/50_app.c`,
  `rg -n 'on\(|AppEvent' src/app.ts src/app-types.ts`,
  `rg -n 'LogLevel|ROTATE_BYTES' src/plugins/logging.ts`.
