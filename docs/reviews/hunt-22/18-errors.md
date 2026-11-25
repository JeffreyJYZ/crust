# Hunt 22 — error handling, codes and refusals

Read-only review. No source file changed. Tree at review: `2174a6d`, clean. All claims below are
`read` unless stated; no probe, build or e2e was run.

## MEDIUM — unmapped failure codes are all sent as HTTP 400, so server-side and security failures read as caller errors

- where: `src/bridge/server/failure-status.ts:13-41` (`CONDITION` table and the `=== undefined ? 400` default), `src/bridge/server/invoke-request.ts:48-52,79`
- mechanism: `resultStatus` maps a typed `{ ok: false, code }` through `CONDITION` and defaults every code it does not name to `400`. The table names only argument/window/platform conditions. Most plugin failure codes are not in it: `signature-mismatch`, `hash-mismatch`, `unverified-artifact`, `relaunch-failed` (`src/plugins/updater-signature.ts:123`, `updater-receipt.ts:58-85`, `updater.ts:166-173`), `io-error`/`corrupt` (`stronghold-file.ts:121-147`), `sql-error` (`database-args.ts:15,41,49`), `contract-violation` (`browser-navigation-contract.ts:29`). All are returned as typed values, so all reach `resultStatus` and all answer 400. `site/app/docs/reference/errors/page.mdx:3` promises the status "agrees with the code"; 400 is the code for a bad request, not for a failed signature check, a corrupt store or a disk error. The `handler-error` → 500 and `unknown-adapter` → 501 rows show the table already means to separate caller faults from server/platform faults.
- reachable by: an app calls `updater.download` with a pinned `updater.pubkey` and an artifact whose signature does not match; the bridge answers `{ ok: true, result: { ok: false, code: "signature-mismatch", … } }` with HTTP 400. A caller that branches on the transport status (the documented second reader of these results) classifies a failed integrity check as a malformed request. Same for `updater.install` returning `relaunch-failed` with `installed: true` — HTTP 400 for an operation that actually succeeded on disk.
- smallest fix: add the server-side codes to `CONDITION` mapped to `handler-error` (500), or change the default from 400 to 500 and map caller-fault codes explicitly; either way make 400 mean "the request was wrong" and 5xx mean "the command ran and failed".

## LOW — `crust perf diff` writes failure messages to stdout

- where: `src/cli/perf/diff.ts:125-141`
- mechanism: `diffFiles` reports an invalid `--tolerance`, an unreadable sample and a sample with no frame block with `console.log`, while every failure path in `src/cli/perf/record.ts` uses `console.error`. The exit code is 1 in all three cases, so the command fails, but the diagnostic lands on the same stream as the report table the command prints on success.
- reachable by: `crust perf diff before.json missing.json > report.txt` writes `crust perf diff: cannot read a sample: …` into `report.txt`, which a downstream reader can mistake for a diff report; nothing is written to stderr.
- smallest fix: use `console.error` for the three failure messages in `diffFiles`, as `record.ts:73-76` does.

## LOW — `PluginRegistry.invoke` executes inherited `Object.prototype` members as commands

- where: `src/plugins/registry.ts:78-84`
- mechanism: `const handler = plugin.commands[commandName]` is a plain prototype-bearing lookup, and the only check is `typeof handler !== "function"`. For `commandName` equal to `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf` or `propertyIsEnumerable`, the lookup returns an inherited function and the guard passes, so `invoke` calls it with `(args, ctx)` as if it were a registered command. The documented `unknown-command` code is therefore never produced for those names. `PluginRegistry` is public via `crust/plugin` (`src/plugins/index.ts:12`, `package.json:16`).
- reachable by: a consumer that calls the exported `registry.invoke(name, command, …)` with a command name from user or wire input. Nothing in this repo calls that method today — the bridge uses the flat `handlerMap` table, which is unaffected — so this is an API defect rather than a live page-reachable path. `handlers()` at `:93-101` uses `Object.entries` and is clean.
- smallest fix: `const handler = Object.hasOwn(plugin.commands, commandName) ? plugin.commands[commandName] : undefined`, so every unregistered name answers `unknown-command`.

## Checked and clean

- Bridge error envelope (`src/bridge/errors.ts`, `server/http.ts`, `server/invoke.ts:62-156`): handler throws keep `code`, `status` and `requires` and gain only the "came from the handler" prefix; non-`CrustError` throws become `handler-error`/500 with the original message; nothing is relabelled as success.
- Body and payload refusals (`server/body.ts`, `server/invoke-request.ts:26-70`): declared and streamed sizes are both capped at 2 MiB, chunk reads count raw bytes, non-JSON JSON bodies answer `bad-json`, and a missing `plugin`/`command` answers `bad-request`.
- Route refusals (`server/handler.ts:71-195`): document token, mint authority, origin and bearer checks each produce their own code; asset fallbacks do not bypass the token gate on `/`.
- Capability gate (`server/capabilities.ts`, `server/actions.ts`): the authority label comes from the token, not the page's `window` hint; `app:invoke` checks the finest dispatched action first and keeps the wire action as a compatibility candidate.
- Config errors (`src/config/schema.ts`, `validator.ts`, `issues.ts`, `validate-security.ts`): all issues are collected before throwing, paths name the offending key, unknown grants and duplicate capability names are refused at load time, and a capability pattern with a dotted spelling is rejected rather than silently matched.
- CLI top level (`src/cli/index.ts:77-129`): unknown commands, bad options and thrown command errors all return exit 1 with the reason on stderr; the no-config hint is keyed on the actual error prefix.
- Doctor exit code (`src/cli/doctor.ts:106-119`): failures from both the check list and the extension verdicts are counted, printed on stderr and returned as exit 1; a red check still lets the remaining checks run.
- Typed sentinel (`src/plugins/define.ts:75-105`, `site/app/docs/reference/api-app/page.mdx:12`): `not-implemented` returned or thrown by an app command becoming a rejection is documented, not a defect; I did not report the shape collision.
- Not repeated from sibling lanes in this hunt: the content-world `no-fetch` readiness result (02), `window.setTitle`'s `invalid-label` code (06), and `perf record` leaving a stale output file (14) were already found; each was checked here and left to its owner.
- Not run: no build, test or e2e was executed, so there is no measured runtime observation in this report.
