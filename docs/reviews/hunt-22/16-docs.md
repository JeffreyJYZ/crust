# hunt-22 · docs claims about `src/` that the code does not keep (16)

Scope: `site/app/docs/**/*.mdx` read against `src/` and `site/public/SKILL.md`. Read-only inspection;
nothing in `src/` or `site/` was edited. Only `rg`/`fd` and file reads. Every finding is a documentation
claim, a code location that contradicts it, and the ordinary path that reaches the contradiction.
Prior docs hunts (hunt-20/17, hunt-21/19, hunt-50/48) were read first; their findings are not repeated
here except where a new half of the same claim is still wrong.

**Count: 7 findings** (1 high, 3 medium, 3 low). Worst is finding 1.

---

## 1 (worst) — the CSP guide says a policy with no `script-src` is fine; the validator refuses it

- `site/app/docs/reference/config/page.mdx:132` — "Config validation therefore refuses a `script-src` without `'unsafe-inline'` (a policy with no `script-src` is fine) and explains why".
- `site/app/docs/limits/page.mdx:73` repeats the rule without the parenthetical, but the same reading is implied.
- `src/config/validate-security.ts:97-108` — `scriptDirective()` chooses the effective inline-script directive in CSP precedence order: `script-src-elem`, then `script-src`, then **`default-src`** (`:106` builds the `default-src` expectation with "script-src falls back to default-src when absent"). `:158-160` refuses whatever directive it finds when `admitsInline()` is false.

The docs describe a single-directive check. The code describes browser resolution: an app policy of
`default-src 'self'; connect-src 'self'` has no `script-src` yet is rejected at startup, and so is a
policy whose `script-src` has the nonce but whose `script-src-elem` does not admit inline. The parenthetical
is not a harmless simplification — it names the one case the validator deliberately handles.

How reached: an author writes the minimal custom policy the docs bless (no `script-src`) and gets a
`ConfigError` naming `security.csp` at launch instead of a running app. The stated reason still applies
(the inline bootstrap would be blocked), so the refusal itself is correct; only the documented acceptance
boundary is wrong. Fix: drop the parenthetical and state that the effective directive is
`script-src-elem` → `script-src` → `default-src`, each checked for `'unsafe-inline'`.

---

## 2 — four API reference pages omit commands the generated registry lists

- `site/app/docs/reference/api-desktop/page.mdx:70-76` — `accessibility` table lists `trusted`, `prompt`, `elementCount`; the generated command table at `site/public/SKILL.md:216` also lists `announce`, `title`, `focus`. `src/plugins/accessibility.ts:97-105` defines all six. The accessibility *guide* (`site/app/docs/guides/accessibility/page.mdx:11-13`) documents the three missing ones.
- `site/app/docs/reference/api-web/page.mdx:77-83` — `crash-reporter` table lists five commands; `SKILL.md:220` and `src/plugins/crash-reporter.ts:38-39,113-140` also define `report` and `configure`. `site/app/docs/guides/crash-reports/page.mdx:42-43` documents both.
- `site/app/docs/reference/api-web/page.mdx:60-65` — `network` table lists `rules`, `setRules`, `log`, `clearLog`; `SKILL.md:234` and `src/plugins/network.ts:145-149` also define `status` and `onChange`. `site/app/docs/guides/network/page.mdx:9-10` documents both. The parity page already says network "stopped being partial when `status`/`onChange` joined the interceptor" (`site/app/docs/reference/parity/page.mdx:134`).
- `site/app/docs/reference/api-app/page.mdx:42-51` — `i18n` table lists four commands; `SKILL.md:229` and `src/plugins/i18n.ts:120` also define `load`. `site/app/docs/guides/i18n/page.mdx:13,32` documents it.

Each table reads as the complete command surface for its namespace, and the imports index promises
"Each page states every command's arguments, its answer and the failure codes it can return"
(`site/app/docs/reference/api/page.mdx:19`). Eight callable commands are invisible there.

How reached: a page author following the reference concludes there is no way to post an AX announcement,
report a page-caught error, repoint the crash directory, read machine connectivity, subscribe to
connectivity changes, or load a locale catalogue from disk. Each call exists and answers; the reference
gives no keyword to search for. Fix: generate the command rows from `scripts/skill/registry.ts` (the same
source as `SKILL.md`) instead of maintaining them by hand.

---

## 3 — CLI reference says "five commands" and omits `crust perf`

- `site/app/docs/reference/cli/page.mdx:3` — "One binary, five commands." The Commands table (`:7-20`) lists `init`, `dev`, `build`, `package`, `doctor`.
- `src/cli/index.ts:32,86` — imports `runPerf` and dispatches `argv[0] === "perf"` before `COMMANDS` is consulted. `src/cli/perf/index.ts:9-21` registers two verbs: `record` and `diff <before> <after>`, each with its own flags and help.
- `site/public/SKILL.md:308-309` and `site/app/docs/guides/performance/page.mdx:117` already document `crust perf record`; `SKILL.md:309` documents `crust perf diff`, which no docs-site page mentions.

`perf` is deliberately outside `COMMANDS` (`src/cli/index.ts:85`), so a reader who checks the command
table in code sees five and stops. The CLI reference is the one page a user consults for the binary's
surface, and it cannot tell them the profiler exists.

How reached: an author chasing the frame numbers on the performance page has to discover `crust perf`
from that guide or `SKILL.md`, not from the CLI reference; the `perf diff` comparison gate is absent
from the docs site entirely. Fix: add a sixth row/paragraph for `crust perf` with its two verbs and
point at the performance guide, and change "five" to "six" (noting `perf` owns its own help).

---

## 4 — `logging.console` is documented as mirroring every record; a built app mirrors only warn and error

- `site/app/docs/reference/config/page.mdx:116` — `console` mirrors "every written record to the terminal".
- `site/app/docs/guides/logging/page.mdx:114-115` — "A built app writes files and stays quiet unless you set `console: true`, which mirrors every written record with the human one-line form."
- `src/logging/logger.ts:65` — the state comment says "In dev every written record is mirrored; the config's `console` mirrors warn and above." `:93-94` sets `mirror` and `dev` from separate options.
- `src/logging/mirror.ts:35-38` — `mirrorRecord()` returns early when `!options.dev && SEVERITY[level] > SEVERITY.warn`. With `SEVERITY` ordered quietest-last (`src/logging/types.ts:13-18`: error 0, warn 1, info 2, debug 3, trace 4), a non-dev process drops every `info`, `debug` and `trace` record even with `console: true`.

The docs promise the dev behaviour for the built-app config key. The routing claim on the next line of
the guide (`:117-119`) is correct; the "every written record" premise is not.

How reached: a shipped app sets `logging.console: true` expecting the same one-line stream `crust dev`
prints; it gets only warnings and errors. An author debugging a silent release build concludes logging
is broken rather than level-filtered. Fix: qualify both sentences — `console: true` mirrors `warn` and
`error` in a built app; every level is mirrored only under `crust dev`.

---

## 5 — network guide names the wrong Linux `requires` string

- `site/app/docs/guides/network/page.mdx:26` — on Linux, `status`/`onChange` answer `not-implemented` naming "`NetworkChangeNotifier from Gdk`".
- `src/plugins/network-status.ts:42` — `REQUIRES.linux` is `"GNetworkMonitor in GIO (libgio-2.0.so.0, loaded through libgtk-3)"`. `:45-47` and the two refusal paths in that file use this map verbatim, and only darwin ships an adapter (`src/runtime-network.ts`), so a Linux call actually carries the GIO string.

How reached: a Linux user sees the refusal, searches for `NetworkChangeNotifier from Gdk`, and finds no
such symbol in crust or its dependencies. Fix: quote the `REQUIRES.linux` value from
`src/plugins/network-status.ts` in the guide.

---

## 6 — `crash-reporter` record shape in the API reference omits `type`, `message` and `stack`

- `site/app/docs/reference/api-web/page.mdx:85` — "A crash record is `{ signal, code, address, at, handler, exitCode }`".
- `src/runtime-crash-write.ts:28-35` — `StoredCrash extends CrashRecord` with a required `type: "signal" | "webview"` and optional `message`/`stack`. `page-cannot-clear` and the guard half both use this shape.
- `site/app/docs/guides/crash-reports/page.mdx:48` documents the full shape, including `type` and how the two halves are told apart.

The reference tells a page to branch on a shape that never exists. `type` is load-bearing: a `"webview"`
record has `signal`/`code`/`address`/`exitCode` all `null` and a `message` instead.

How reached: an author following the reference destructures only the six named fields, so every
page-caught error lands as an object whose `message` and `stack` are dropped and cannot tell a fault
from a report. Fix: use the guide's shape at `crash-reports/page.mdx:48` in the reference too.

---

## 7 — network body bound described as "over 262144"; the code refuses at exactly 262144

- `site/app/docs/reference/api-web/page.mdx:69` — "a body over 262144 bytes ... is refused by name".
- `src/plugins/network-rules.ts:69` — `if (bytes >= NETWORK_BODY_LIMIT)` with `NETWORK_BODY_LIMIT = 262144` (`src/plugins/network-types.ts:35`); the message says 262143 is the most the native buffer can deliver.

The other three bounds in the same sentence are strict `>` comparisons (`:20` pattern length, `:28`
wildcard count, `:78` content type), so this one is a real off-by-one, not a house style. A 262144-byte
body is accepted by the documented rule and refused by the code.

How reached: a page author sizes an `allow` rule to the documented ceiling, gets `bad-request`, and has
no way to tell from the docs that the last byte must be dropped. Fix: say "262144 bytes or more" and name
262143 as the deliverable maximum, matching the refusal message.

---

## Checked and clean

- CLI command table: `src/cli/commands.ts` exports exactly `init`, `dev`, `build`, `package`, `doctor` (`read`), matching `reference/cli` apart from finding 3; flags, `--dir`/`--config`/`--entry`/`--format`, stage ordering and the environment table match `src/cli/help.ts` and `src/cli/index.ts`.
- Config defaults: window 1100×760 and minimums 0 (`src/platform/windows/platform-config.ts:7-8`, `src/platform/linux/backend.ts:62-63`), `minimumSystemVersion` `"13.0"` (`src/cli/build.ts:37`), log dir `"logs"`, generations 3 and maxBytes 5 MiB (`src/logging/types.ts:88-95`) all match `reference/config`.
- Bridge port: `preferredPortFor` FNV-1a into `45000 + hash % 4000` (`src/runtime-host.ts:22-30`) and the 20 upward attempts plus OS-assigned 21st (`src/cli/doctor/bridge.ts:36-48`) match `reference/config-rules`.
- Failure codes and messages: the `CrustError` table matches `src/bridge/errors.ts` (`read`); the quoted bearer/JSON/body messages match `src/bridge/server/invoke-request.ts:29,42,66,69` and `src/bridge/server/handler.ts:79,171`; 2 MiB cap is `MAX_BODY_BYTES` (`src/bridge/server/body.ts:12`).
- Network bounds other than finding 7: pattern 2048, wildcards 32, content type 127, URL 2047 and log limit 100 match `src/plugins/network-types.ts` and `src/plugins/network.ts:108-110,127`.
- Shell and crash caps: 500 lines per stream (`src/plugins/shell-stream.ts:8`) and 256 finished records (`src/plugins/shell.ts:26`) match `reference/api-fs`; `MAX_CRASH_RECORDS = 200` matches `guides/crash-reports`.
- `POWER_COMMANDS` order (`src/plugins/power.ts:46-57`) and the window command set (`reference/api-window:11-37`) match `SKILL.md`; one assertion per process (`src/plugins/power.ts:94-99`) matches `reference/api-desktop`.
- Version pins: `SKILL.md:21-22,27` and `site/app/docs/start/install/page.mdx:55,94,111` pin `v0.2.18`, matching `package.json:3` and the local tag list (`measured`).
- Dev watch: the ignored path set and frontend extension list in `src/cli/ignore.ts` match `guides/dev:46-50`; `beforeDevCommand` is spawned un-awaited and the 30 s URL probe match the code.
- Capability prose: the token-bound authority and the `app:invoke` / narrow `app:<name>` candidate check match `src/bridge/server/invoke.ts:44-72`; in-process `app.invoke` bypasses the runner (`:40-42`), matching `guides/permissions`.
