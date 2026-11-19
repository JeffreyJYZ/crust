# One build command with stage flags

The owner's complaint: "`crust dmg` `crust build` `crust package`, all just basically build." Five verbs
expose an implicit pipeline, and nothing enforces its order — `crust dmg` fails with "run crust build
first", `notarize` is meaningless without `sign`, and `package` will wrap a stale `.app` from an earlier
build.

They chose shape A:

```
crust build                       .app only (today's behaviour)
crust build --dmg                 + disk image
crust build --sign --notarize --dmg   the full release chain, in the right order
crust package --format nsis,appimage  cross-platform installers, unchanged
```

## What to do

1. **`crust build` gains `--sign`, `--notarize`, `--dmg`.** Each is a stage, run in the order the release
   actually needs, inside one command with one exit code. Read the existing `sign.ts`, `notarize.ts` and
   `dmg.ts` first and get that order right — a dmg of an unsigned `.app`, or a notarize of an unsigned
   bundle, is an artefact Apple refuses, so the sequence is not a style choice:
   - sign the `.app`, notarize it, staple it, then build the dmg from the stapled app;
   - if the dmg itself must be notarized, sign it, notarize it and staple it, and say in a comment which
     order you implemented and why.
2. **Refuse impossible combinations by name**, before doing any work: `--notarize` without `--sign` (there
   is nothing to submit), `--dmg` on a platform that has no disk image, `--sign` with no identity in the
   environment. Each message says what is missing, not just "invalid".
3. **Delete `sign`, `dmg` and `notarize` as public commands.** Their handlers stay as internal steps; the
   `COMMANDS` table, the help, and `src/cli/cli-contract.test.ts` lose them. Update that contract file's
   rows rather than deleting coverage — every behaviour it pins must still hold for `build` and
   `package`.
4. **`crust package` keeps its formats** and still needs a built artefact. If you can make it build the
   artefact when it is missing or older than the sources, do — but say so, and keep the exit code honest
   for a format whose tool is absent (it prints `requires` and exits 1 without stopping the others).
5. **Docs are a second lane's job.** Do not touch `site/**`; list the pages that need updating in your
   final message so the next lane does not have to rediscover them.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Red first**: the contract test rows for the removed verbs must fail before the change and pass after.
- `crust build --sign` and `--notarize` need a certificate and Apple credentials this machine does not
  have — prove those paths by refusing correctly, not by signing something.
- **Never launch a GUI app.** `crust build` does not open a window; if you run it, run it on `examples/hello`
  and delete the output. Anything that could take the screen goes through `probe-run`.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/cli/**` and its tests. Nothing under `site/`, `scripts/` or `src/platform/`.

## Prove, and paste the output

- The new help screen (`crust --help` and `crust build --help`), showing the flags and no `sign`/`dmg`/
  `notarize` verbs.
- The four refusals, with their messages and exit codes.
- `crust build` and `crust build --dmg` on `examples/hello`, with the artefacts they produce.
- `bun test src/cli`, `bun run test`, `bun check`, `bun run check:lines`.

Final message under 12 lines: the stage order you implemented, the refusals, the files touched, and the
docs pages that now describe removed commands.
