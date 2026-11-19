# Hunt 50 · 44 · Config defaults that surprise

Scope: every file in `src/config/` (`schema.ts`, `types.ts`, `load.ts`, `issues.ts`, `validator.ts`, and the `validate-*.ts` set plus their tests). Consumers in `src/bridge/server/`, `src/plugins/`, `src/platform/darwin/`, `src/cli/` and `src/runtime` were read for reach only.

Method: `fd`/`rg` to enumerate and cross-reference, then read each config file. Probes were read-only (`bun` scripts in the session temp dir calling `validateConfig`/`compileCapabilities`/`findConfig`); no source edits, no screen-touching probes.

**Count: 7 findings (2 high, 3 medium, 2 low). Worst is #1.**

---

## 1. HIGH (worst) — an explicitly empty `security.capabilities: []` is accepted and means "allow every command"

`src/config/validate-security.ts:16-21` refuses only a non-array; an empty array passes with no issue (`value.forEach` over zero items, line 23), and `validateConfig` returns it as valid (`schema.ts:58-59`).

`src/bridge/server/capabilities.ts:80-81` then does:

```
const capabilities = security?.capabilities ?? [];
if (capabilities.length === 0) return OPEN;
```

and `OPEN` is `allows: () => true` (`capabilities.ts:43-48`). `createRunner` defaults to the same open table when no security is supplied (`src/bridge/server/invoke.ts:48`), so an app with no `security` section is also fully open.

Reached by: a config that adds `security: { capabilities: [] }` — the natural way for an author to say "grant nothing" — and by every app that simply omits `security`. `compileCapabilities` returns `open: true`, `invoke.ts:60-64` admits every `plugin:command`, including `shell:spawn` and `fs:*`. Authority checks are bypassed before they start. Probe: `validateConfig` ACCEPT for the empty list; `compileCapabilities({ capabilities: [] }).open === true`.

Worst because the fail-open is silent and in the security-expanding direction: the config that *looks* like a lockdown is the one that grants the most. The type comment at `types.ts:84` and the rule at `capabilities.ts:8-9` document the compatibility reason, but there is no warning at validation time, and the author cannot tell from the file that they made the app wide open.

## 2. HIGH — `security.grants` keys are never checked against `windows[].label`; a typo silently grants nothing

`src/config/validate-security.ts:63-84` validates each grant's *capability names* against the declared set (line 76) but only checks that the *label key* is non-empty (line 69). `schema.ts:44-45` calls `validateWindows` and `validateSecurity` independently; no cross-check exists.

Reached by: `security.grants = { "ma in": ["panels"] }` with `windows: [{ label: "main" }]` and a capability `panels`. Validation accepts it; `compileCapabilities` builds a `perLabel` entry under `"ma in"` (`capabilities.ts:88-93`), so the real window `main` holds no patterns and every invoke from it is refused with `forbidden` (`invoke.ts:63-64`). Probe: ACCEPT, `allows("main", "dialog:open") === false`, `allows("ma in", "dialog:open") === true`. The failure is silent at config time and only appears as a runtime "not granted" message for a grant the author believes is present.

## 3. MEDIUM — CSP validation ignores `script-src-elem`, so a policy that still blocks the bootstrap is accepted

`src/config/validate-security.ts:104-118` `scriptDirective` examines only `script-src` and `default-src`. CSP3 gives `script-src-elem` precedence over `script-src` for `<script>` elements, and a strict `script-src-elem` with no `'unsafe-inline'` blocks them even when `script-src` is loose.

Reached by: `security.csp = "script-src 'self' 'unsafe-inline'; script-src-elem 'self'"`. Validation ACCEPTs (probe) because it sees `'unsafe-inline'` in `script-src`. The bridge serves the config policy whole and stamps the bootstrap with a nonce that the custom header never names (`assets.ts:141`, `csp-nonce.test.ts:98-106`), so the inline `window.crust` bootstrap is governed by `script-src-elem 'self'` and blocked — exactly the silent failure the validator's `CSP_REASON` (`validate-security.ts:93-95`) claims to prevent.

## 4. MEDIUM — `admitsInline` does not account for a nonce/hash source making `'unsafe-inline'` ineffective

`src/config/validate-security.ts:121-123` treats the presence of the literal `'unsafe-inline'` as sufficient. Under CSP, if a script source list also contains a `'nonce-…'` or `'sha256-…'` source, `'unsafe-inline'` is ignored.

Reached by: `security.csp = "script-src 'self' 'unsafe-inline' 'nonce-abc'"` (or a hash source). Validation ACCEPTs (probe). The nonce is static and cannot match the bridge's per-response nonce (`assets.ts:125`), and `'unsafe-inline'` is ignored because a nonce source is present, so the bootstrap is blocked and every invoke silently fails. Same failure mode as #3, driven by a different directive shape.

## 5. MEDIUM — `findConfig` discovers only 2 of the 5 config filenames the loader supports

`src/config/load.ts:7` `CONFIG_FILES = ["crust.config.ts", "crust.json"]`, and `findConfig` (lines 55-61) checks only those two. But `readConfig` (lines 82-87) accepts `.ts`, `.mts`, `.js`, `.mjs` and `.json`.

Reached by: `crust dev`/`build` with a project whose only config is `crust.config.mjs`, `crust.config.js` or `crust.config.mts` — all supported by `readConfig` when given an explicit `configPath`. `loadConfig()` with default options (lines 38-46) throws `no crust config in …: expected crust.config.ts or crust.json`, so a valid config format is unusable unless the user knows to pass `configPath`. Probe: `findConfig` returns the file for `.ts` and `.json`, `undefined` for the other three.

## 6. LOW — `extensions` path guard rejects any filename beginning with two dots

`src/config/validate-extensions.ts:36` uses `normalize(item).startsWith("..")` to detect a climb out of the project. Any in-project path whose first segment merely *starts* with `..` is also refused.

Reached by: `extensions: ["..notes.ts"]` where `..notes.ts` is a real file in the project root. `normalize("..notes.ts")` is `"..notes.ts"` — no `..` segment — but `startsWith("..")` is true, so validation fails with `extensions[0] — expected a path inside the project`. Probe confirms REJECT while `notes.ts` is ACCEPTed. The intended test is a leading `..` *segment* (`item === ".." || item.startsWith("../")` on POSIX, with the Windows separator too).

## 7. LOW — `updater.autoCheck` is an inert config flag

`src/config/validate-updater.ts:24-27` validates `autoCheck` as a boolean, and `types.ts:113-117` documents that it is only reported by `updater.config`: `src/plugins/updater.ts:72` echoes it as `options.autoCheck === true`; no code calls `check` on startup.

Reached by: an app setting `updater.autoCheck: true` expecting crust to poll for updates. Validation accepts it, `updater.config` reports `true`, and no check ever runs — the page must call `updater.check` itself. The type comment states this, but the field name and its presence in the config surface read as an enable flag; the surprise is that the only observable effect is the echo.

---

## Notes / non-findings

- No double-default: `app.activate` is defaulted to `"always"` in exactly one place (`platform/darwin/platform.ts:34`), matching `types.ts:40` and `validate-activate.ts`. The focus-stealing effect is deliberate and documented.
- `fs.scope` absent = unrestricted (`types.ts:98`, `fs-scope.ts:10-12,71-72`) and `shell` absent = deny-all are consistent between the config comments and their consumers; they are surprising defaults but not defects.
- `build.assets` absent = `public` with no existence check (`resolve-assets.ts:42-49`) is an explicit backward-compatibility choice, labelled as such in the same comment.
- `validate-app.ts:13-15` blocks `app.id` values that escape the state directory; `validate-build.ts:24-31` blocks absolute/escaping sidecars via `resolveSidecar`; `validate-updater.ts:19-22` checks the pubkey's shape. No defect found in those paths.
- The `..notes.ts` false positive (#6) is the only path-validation over-match found; `validate-fs.ts` correctly requires absolute prefixes and `validate-dev.ts` correctly refuses hostless URLs.
