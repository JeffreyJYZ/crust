# Configuration — defect hunt

Scope: `src/config/**`, the config types, and the first consumers that turn a config value into behaviour.

## High — `dev.url` is validated as a non-empty string, not a URL; the common scheme-less spelling fails 30 s later

- where: `src/config/validate-dev.ts:10`; consumed at `src/cli/dev/frontend.ts:21`, `src/runtime-host.ts:9-15`, `src/app-loop.ts:53`
- mechanism: `v.string(dev, "url", "dev", false)` accepts any non-blank string and returns it unmodified. `crust dev` then calls `new URL(devUrl)` in `waitForDevServer`. `dev.url: "localhost:5173"` parses as scheme `localhost:` with an empty hostname and port, so the 30 s TCP wait targets hostname `""` port 80 and times out. `dev.url: "not a url"` makes `new URL` throw uncaught. `originOf` separately returns `"null"` for the scheme-less form, so the bridge's allowed dev origin is wrong too.
- reachable by: `measured` — `bun -e 'new URL("localhost:5173")'` yields `{protocol:"localhost:", hostname:"", port:"", origin:"null"}`; `new URL("not a url")` throws `Invalid URL`. `read` — neither form is refused by `validateConfig`, and both reach the consumer verbatim. A user who omits `http://` (a very common spelling) gets "`localhost:5173` did not accept a connection within 30 s" or an uncaught stack trace instead of a config error naming `dev.url`.
- smallest fix: parse `dev.url` in `validateDev` with `new URL`, require an `http:`/`https:` protocol and a non-empty hostname, and fail with `expected an absolute http(s) URL`.

## High — a custom `security.csp` can never admit the per-response nonce, so the bootstrap is blocked

- where: `src/config/validate-security.ts:91`; `src/bridge/server/csp.ts:9-10,31-32,45-49`; `src/bridge/server/assets.ts:125-141`
- mechanism: `v.string(security, "csp", "security", false)` accepts any non-empty string. Every document response mints a fresh random nonce, stamps all inline scripts (the `window.crust` bootstrap and the `invoke` shim) with it, and sends the user's CSP string verbatim. A strict policy of the kind the docs tell security-conscious users to write — e.g. `script-src 'self'` with no `'unsafe-inline'` — cannot contain that random nonce at config time, so every inline script is refused by the browser. The page loads but `window.crust` never installs and every invoke fails.
- reachable by: `read` — set `security.csp` to a normal strict policy (any `script-src` lacking `'unsafe-inline'`), run `crust dev` or a built app, and observe the served HTML carrying `nonce=` attributes the policy does not admit. `site/app/docs/reference/config/page.mdx:106` only warns about `connect-src 'self'` and says "a policy you write is yours to get right"; it never states that the nonce is unknowable at config time and that `'unsafe-inline'` is the only way a custom policy can work.
- smallest fix: at validation time either reject a `script-src` that lacks `'unsafe-inline'` with a message explaining the per-response nonce, or provide a stable nonce placeholder the bridge substitutes into the configured policy.

## Medium — unset `build.assets` skips every check, so a project with no `public/` builds a bundle with zero assets

- where: `src/config/validate-build.ts:19`; `src/cli/build/resolve-assets.ts:42-49,83`; `src/cli/build/assets.ts:41-42`; `site/app/docs/reference/config/page.mdx:77`
- mechanism: `resolveAssets` wraps all existence and `index.html` checks in `if (setting)`. When `build.assets` is absent, `collectAssets(publicDir)` returns `[]` if `public/` does not exist, and the build reports success with an empty asset table. The configured default therefore does not satisfy the documented contract that `assets` "must hold `index.html`".
- reachable by: `read` — a backend-only project or one whose frontend lives elsewhere, with no `public/` directory, runs `crust build`, gets a green build, and ships an app whose bridge has no `/index.html` to serve (blank window). The code comment at `resolve-assets.ts:46-48` states this is intended, so the defect is the contradiction with the documented default, plus the absence of any warning.
- smallest fix: apply the same `index.html` check to the resolved default directory, or make the missing-default case a build failure/warning that names `build.assets`.

## Medium — `minimumSystemVersion` accepts any string; `crust doctor` reports green for garbage

- where: `src/config/validate-build.ts:20`; `src/cli/doctor/check.ts:30-38`; `src/cli/doctor/environment.ts:104-112`; `src/cli/build.ts:71-72`; `src/packaging/plist.ts:71`
- mechanism: the validator only checks a non-empty string. The value is written to `LSMinimumSystemVersion` in `Info.plist` and compared by `versionAtLeast`, which maps every non-numeric component to `0`. A typo such as `"banana"`, `"abc.def"` or `""` therefore compares as 0 and always satisfies the check.
- reachable by: `measured` — re-running the `versionAtLeast` body gives `versionAtLeast("13.6", "banana") === true` and `versionAtLeast("13.6", "abc.def") === true`. `read` — `crust doctor` prints an `ok` line for such a value and `crust build` bakes it into the plist; macOS then refuses to launch the app for a reason unrelated to the config key the user typed.
- smallest fix: validate `minimumSystemVersion` as a dotted numeric version (`^\d+(\.\d+){0,2}$`) in `validateBuild`.

## Medium — window labels and grant keys accept surrounding whitespace that is trimmed at use, silently dropping all capabilities

- where: `src/config/validator.ts:47-51`; `src/config/validate-security.ts:67-83`; `src/bridge/window-identity.ts:99-103`; `src/bridge/server/assets.ts:72,80`; `src/bridge/server/capabilities.ts:88-100`
- mechanism: `v.string` returns the original value whenever `value.trim()` is non-empty, so a window label `"main "` or a grants key `"main "` is stored with the space. The bridge binds the window label through `windowLabelFromSearch`/`asWindowLabel`, which trims it to `"main"`. `compileCapabilities` keys `grants` by the untrimmed config string, so `perLabel.get("main")` is undefined and the window holds no capabilities.
- reachable by: `read` — write `windows: [{ label: "main " }]` and `security.grants: { "main ": [...] }`, or only put the space in one of them; the config validates, the window opens, and every command is denied with "`… is not granted to window "main": no configured capability lists this action`" (or a misleading "would allow it — add it to that label's grants" hint).
- smallest fix: trim (and reject a changed value) for `label`, `app.id` and grant labels during validation, and use the same normalization when compiling capabilities.

## Low — `security.grants` keys are never checked against the configured window labels

- where: `src/config/validate-security.ts:63-100`; `src/config/schema.ts:44-45`; `src/bridge/server/capabilities.ts:88-100`
- mechanism: `validateGrants` verifies that grant *values* name declared capabilities, but never checks that grant *keys* name a window in `config.windows`. A typo in the label key (e.g. `"man"` for window `"main"`) validates, and `compileCapabilities` stores a `perLabel` entry that no window's bound label can ever match.
- reachable by: `read` — set a correct capability list and a misspelled grants key; startup and `crust doctor` are clean, the window opens, and every invoke is denied. `validateConfig` calls `validateSecurity(v, root.security)` without the windows list, so it cannot perform the check as structured today.
- smallest fix: pass the validated window labels into `validateSecurity` (or add a root-level cross-check in `validateConfig`) and fail on any grant key that names no window.

## Low — `build.urlScheme` is validated only at build time, not with the rest of the config

- where: `src/config/validate-build.ts:21`; `src/packaging/deep-link.ts:27-43`
- mechanism: the config validator accepts any non-empty string for `urlScheme`; the RFC-3986/reserved-scheme check lives in `validateScheme`, called only during packaging. A bad scheme passes `crust dev` and every config gate, then fails late in `crust build`.
- reachable by: `read` — set `build.urlScheme: "HTTP"` or `"my scheme"` and run `crust dev`: clean; `crust build`: `crust: deep-link scheme … is reserved/must match [a-z][a-z0-9+.-]*`. The config page promises unknown/typo'd keys are a startup failure, but this value-shaped error is not.
- smallest fix: import and call `validateScheme` from `validateBuild`, mapping its `CrustError` into a `ConfigIssue` on `build.urlScheme`.

## Checked and clean

- Unknown keys: `read` — `v.only` is applied at root and every mapped level (`app`, each `windows[]`, `dev`, `build`, `security`, each `capabilities[]`, `fs`, `shell`, `updater`); `grants` is a label-keyed record, so leaving it unchecked is correct. No silent key ignore found.
- `app.id`, sidecars and extension paths: `read` — separators/path tokens are refused in `validateApp`; sidecars are checked against `resolveSidecar` for absolute/Windows-absolute/`..`; extension entries are only refused when a relative path climbs out of the project. No traversal path found that validation admits.
- Capability action shape and name graph: `read` — `ACTION` pins `plugin:command` with `*` as the only metacharacter; duplicate capability names and grants naming unknown capabilities are refused. Empty `capabilities` intentionally means allow-all (documented compatibility), and a config with `grants` but no `capabilities` cannot pass validation because every grant name would be unknown.
- `updater.pubkey`: `read` — `BASE64_32` pins exactly 43 alphabet characters with optional padding, which decodes to 32 bytes; 31- and 33-byte encodings cannot match. `autoCheck`/`allowFileUrl` are typed as booleans.
- `window.material`: `read` — validated against `allowedWindowMaterials(process.platform)`, so a name the current platform cannot apply is a startup error naming the key. Cross-platform config copying is refused by design and documented.
- Env overrides: `read` — `CRUST_DATA_DIR`, `CRUST_SIDECARS_DIR`, `CRUST_BRIDGE_URL`/`_TOKEN` and `CRUST_DEV_FILE` are documented operator overrides, not config values being silently replaced; no undocumented env var clobbers a user-written config key found.
