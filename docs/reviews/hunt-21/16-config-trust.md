# Configuration as a trust boundary — hunt-21 lane 16

Prior round: `docs/reviews/hunt-20/14-config.md`. Items it reported and fixed (`dev.url`, the basic
`security.csp` `'unsafe-inline'` rule) are not repeated here; a bypass of the CSP fix and the items
it reported but did not fix are covered below.

## High — a custom CSP can bypass the nonce guard with `script-src-elem`

- where: `src/config/validate-security.ts:104-123`, `src/config/validate-security.ts:148-154`; served at `src/bridge/server/assets.ts:141` and stamped at `src/bridge/server/csp.ts:38-40`
- mechanism: `scriptDirective()` only inspects `script-src` and `default-src`. CSP3's `script-src-elem` governs inline `<script>` blocks and, when present, overrides both `script-src` and `default-src` for those elements (read: MDN `Content-Security-Policy/script-src-elem` — "valid sources in `<script>` elements (both script requests and blocks) ... If this directive is absent ... script-src ... default-src"). The bridge mints a fresh nonce, stamps `window.crust`'s bootstrap and the runtime's `invoke` shim with it, and sends an app-supplied `security.csp` verbatim; it never rewrites that policy. A policy whose effective element directive is `script-src-elem 'self'` (or `'none'`, or a stale nonce) admits none of those inline scripts. The page loads, but `window.crust` never installs and every invoke fails — the exact failure hunt-20's check exists to prevent.
- reachable by: `measured` — `validateConfig` accepts `security.csp` of `script-src-elem 'self'`, of `script-src 'unsafe-inline'; script-src-elem 'none'`, and of `default-src 'unsafe-inline'; script-src-elem 'self'`; only the middle one even has a directive the current check looks at, and it passes because `script-src` has `'unsafe-inline'`. `read` — `documentResponse` passes `csp` straight to `headersFor`, `defaultCsp(nonce)` only appends `'nonce-…'` to the *default* `script-src`, and `injectBootstrap` produces an inline `<script nonce=…>` that the custom policy governs.
- smallest fix: make the validator resolve the effective inline-script directive in CSP3 order (`script-src-elem`, then `script-src`, then `default-src`) and require `'unsafe-inline'` or a documented nonce placeholder there; name `security.csp` and the directive that actually governs inline scripts in the failure.

## High — `shell.allow` misses common interpreters, so a list that no longer bounds execution validates silently

- where: `src/config/validate-shell.ts:7-18` (`INTERPRETER`), `src/config/validate-shell.ts:47-64`; enforced at `src/plugins/shell-resolve.ts:66-76,133-175` and `src/plugins/shell-args.ts:52-69`
- mechanism: the warning exists because naming a language "hands the page every binary and every file this process can reach — `sh -c`, `node -e`, `python -c` — so the allow list stops bounding what runs". The regex is a fixed list, but `awk`, `gawk`, `sed`, `find`, `git`, `tar`, `busybox`, `xargs`, `npx`, `npm`, `make`, `sudo`, `cmake`, `go`, `java`, `ssh`, `powershell` and `cmd.exe` are all absent. Each can run a command from argv that the page supplies: `awk 'BEGIN{system("…")}'`, `find . -exec …`, `tar --checkpoint-action=exec=…`, `npx -c …`, `git -c core.fsmonitor=…`. `readArgs` rejects only null bytes, so those arguments reach `Bun.spawn` unchanged. An app that allowlists `awk` believing it to be a bounded tool gets no warning at config time and a page-reachable command-execution path.
- reachable by: `measured` — the `INTERPRETER` regex returns false for all the names above, and a `validateConfig` run with `shell.allow: ["awk"]`, `["find"]`, `["xargs"]`, `["npx"]`, `["powershell.exe"]` emits no `console.warn`, while the same run with `["sh"]` emits the documented warning. `read` — a bare name is resolved on PATH, added to `rules.allowed`, and any page argument array with string entries passes `readArgs`.
- smallest fix: replace the fixed regex with the set of program names that carry their own execution primitive, including `awk`/`gawk`, `find`, `xargs`, `tar`, `git`, `busybox`, `npx`/`npm`, `make`, `sudo`, `powershell*`/`cmd*`, and warn on the resolved base name; keep the warning advisory if changing it to a refusal would break deliberate allowlists.

## Medium — `logging.dir` escapes the app data root with `..` segments

- where: `src/config/validate-logging.ts:26-29`; consumed at `src/logging/paths.ts:33-39` and `src/logging/logger.ts:77-79`
- mechanism: the validator's own rule says a `dir` that leaves the app's data root must be refused, but the check is only `dir.startsWith("/")`. `logDirs` joins a relative `dir` onto the root with `node:path.join`, which folds `..` and walks out of it. Log files (and rotated generations) are then written beside or above the app's data directory, not inside it. The same one-character check also misses Windows drive-absolute and UNC spellings, which `isAbsolute` in `logDirs` accepts as absolute.
- reachable by: `measured` — `logging.dir: "../../etc"` validates; `logDirs({root:"/Users/jyz/Library/Application Support/myapp", dir:"../../etc"}).logs` is `/Users/jyz/Library/etc`, two directories above the configured root. `measured` — `path.win32.isAbsolute("C:\\logs")` and `path.win32.isAbsolute("\\\\server\\share")` are both true while neither string starts with `/` (Node path semantics, not a Windows runtime observation).
- smallest fix: require a relative path with no absolute form for the running platform and no `..` segment (compare `resolve(root, dir)` against `root` with a trailing separator), and fail with `logging.dir` named.

## Medium — duplicate `windows[].label` values validate and then crash startup

- where: `src/config/validate-windows.ts:33-56`; created at `src/app-windows.ts:56-67`, `src/app.ts:162`; refusal thrown at `src/platform/darwin/window-adapter.ts:79-87` (and the windows/linux adapters)
- mechanism: `validateWindows` checks each window's fields but never checks that labels are unique. `openWindows` calls `platform.createWindow` once per entry with no `try/catch`; the platform refuses the second label with `WindowAdapterError("duplicate-label")`, which propagates out of `app.run()` as a startup failure. Labels are also the keys of `security.grants`, so a duplicate makes the grant table ambiguous. The error names a window label, not `windows[1].label`, and it arrives from a native adapter instead of `ConfigError`.
- reachable by: `measured` — `validateConfig({windows:[{label:"main"},{label:"main"}]})` returns a config with both labels. `read` — `openWindows` creates both in order and the darwin adapter throws on the second; `app.run()` does not catch it.
- smallest fix: track seen labels in `validateWindows` and fail with `windows[i].label` and "a label no other window uses", the same shape as the duplicate capability-name check.

## Medium — `build.assets` accepts absolute and climbing paths

- where: `src/config/validate-build.ts:19`; consumed at `src/cli/build/resolve-assets.ts:42-83` and `src/cli/build/assets.ts:41-54`
- mechanism: unlike `build.sidecars` (checked against `resolveSidecar`) and `extensions` (refused when a relative entry climbs out), `build.assets` is only a non-blank string. `resolveAssets` does `resolve(dir, setting)`, so an absolute value or one containing `..` points outside the project. The checks that were added for hunt-20 only reject `assetsDir === outDir`, a missing directory and a missing `index.html`; they do not test containment. `collectAssets` then walks that tree and embeds every file into the shipped binary — a build machine path such as `../../` with an `index.html` can leak files the project never declared.
- reachable by: `measured` — `validateConfig` accepts `build.assets: "/etc"` and `build.assets: "../../etc"`; `resolve("/project", "/etc")` and `resolve("/project", "../../etc")` both leave the project. `read` — `resolveAssets` applies only the three checks above before `collectAssets`.
- smallest fix: require a project-relative path (refuse absolute/win32-absolute and any `..` segment, or compare the resolved directory with the project root) and fail with `build.assets` named, alongside the existing `dist` and `index.html` checks.

## Low — `plugins: [""]` validates, then fails with a plain error that hides the key

- where: `src/config/schema.ts:58` (`v.stringArray(root, "plugins", "config")`), `src/runtime-shim.ts:29-47`
- mechanism: `Validator.stringArray` accepts any array of strings, including empty ones. `selectedPlugins` maps each entry through `pluginName`, which leaves `""` unchanged, then throws a plain `Error` reading `crust: unknown plugin "" — v1 ships …`. That message names the value but not `config.plugins[0]`, is not a `ConfigError` and carries no `issues` array, so the documented validation contract ("every issue names the offending key") does not hold for this key.
- reachable by: `measured` — `validateConfig({plugins:[""]})` succeeds. `read` — `selectedPlugins` is called at bridge start (`src/runtime.ts:104-105`), where the empty name misses every registered plugin name.
- smallest fix: refuse blank entries in a `plugins` array with issue path `config.plugins[i]`, and keep the unknown-name failure shaped as a `ConfigError`.

## Low — `app.icon` accepts an absolute path with no containment check

- where: `src/config/validate-app.ts:18`; consumed at `src/cli/build.ts:70-79` and `src/cli/package/` icon paths
- mechanism: the validator calls `v.string` only, while the consumer does `resolve(options.dir, config.app.icon)`. An absolute icon path is used verbatim, so `crust build` reads a PNG from anywhere on the build machine. The file is signature-checked as a PNG, so this is a declared-path hole rather than arbitrary-byte injection, but it contradicts the documented "PNG resolved against `--dir`".
- reachable by: `measured` — `validateConfig` accepts `app.icon: "/etc/passwd"`. `read` — the build resolves that value against the project dir but `resolve` returns the absolute argument unchanged; packaging then reads it.
- smallest fix: apply the same relative-path rule used for `build.sidecars` to `app.icon` and name `app.icon` in the failure.

## Low — `browser.origins` accepts credentials that are silently dropped

- where: `src/config/validate-features.ts:46-66`; normalized at `src/plugins/browser-origin.ts:14-24,33-36`
- mechanism: an entry like `https://user:pass@example.com` has `pathname: "/"`, no query and no fragment, so validation accepts it. `originPolicy` normalises with `new URL(entry).origin`, which discards userinfo, and the effective allow list becomes `https://example.com`. A policy that looks scoped to a credentialed endpoint silently authorises every path on that origin.
- reachable by: `measured` — `validateConfig` accepts `browser.origins: ["https://u:p@example.com"]`. `read` — `originOf` returns `url.origin`, which excludes credentials.
- smallest fix: refuse `url.username !== "" || url.password !== ""` in `validateBrowser` with `browser.origins[i]` and a message that origins are scheme, host and port only.

## Re-checked from hunt-20 (still open)

- `security.grants` keys are still never compared with `windows[].label` (`src/config/validate-security.ts:143-165` takes no windows list); the misspelled-key denial from hunt-20's Low still stands, and duplicate labels above make it worse.
- `build.minimumSystemVersion` and `build.urlScheme` are still plain `v.string` checks (`src/config/validate-build.ts:20-21`); both still fail late in `crust doctor`/packaging as hunt-20 reported.
- `build.assets` unset still skips the existence and `index.html` checks (`src/cli/build/resolve-assets.ts:49`); the fix added checks only for a named directory.
- Whitespace in `windows[].label` and grant keys is still returned untrimmed by `Validator.string` (`src/config/validator.ts:41-52`) and still trimmed at use (`src/bridge/window-identity.ts:98-103`), so hunt-20's Medium is open.

## Checked and clean

- `dev.url`: `read` + `measured` — `validateDev` now parses with `new URL` and requires `http(s)` plus a non-empty hostname; `localhost:5173`, `not a url`, `file:///etc` and `""` are all refused with `dev.url` named. hunt-20's High is fixed, and `originOf` in `runtime-host.ts` cannot produce `"null"` from a value that passed.
- `security.csp` `script-src`/`default-src`: `read` — the case-insensitive directive scan and `'unsafe-inline'` word match correctly cover the classic spelling and the fallback; the finding above is the CSP3 directive it misses, not a failure of that branch.
- `browser.origins` grammar otherwise: `read` + `measured` — non-http(s) schemes, hostless strings, paths, queries and fragments are refused with `browser.origins[i]`; a trailing slash passes and normalises to the same origin, which is correct.
- `fs.scope` and `shell.cwdRoot`: `read` + `measured` — both require `isAbsolute`; `".."`, `"./data"` and `"/tmp/.."`-style relative entries are refused for `cwdRoot` and relative entries for `fs.scope`. Canonicalisation and symlink handling happen in `src/plugins/fs-scope-path.ts` before comparison, not in the validator.
- Capability and grant values: `read` — `ACTION` pins `plugin:command` with `*` only in the command part; duplicate capability names, empty action lists, non-string actions, blank grant labels and grants naming unknown capabilities all fail with indexed paths.
- `updater.pubkey`: `read` — `BASE64_32` pins 43 alphabet characters with optional padding, which decodes to exactly 32 bytes; wrong-size keys cannot pass. `autoCheck` and `allowFileUrl` are typed booleans.
- `windows[].material`: `read` + `measured` — `allowedWindowMaterials(process.platform)` refuses a backdrop the running OS cannot apply and names `windows[i].material` and the platform.
- Extension and sidecar paths: `read` — relative `extensions` entries that climb out are refused, and `build.sidecars` entries are checked with `resolveSidecar` for absolute paths and `.`/`..` segments; the missing equivalent checks on `build.assets` and `app.icon` are the findings above.
- Config loading: `read` — `loadConfig` names the file for a missing config, missing explicit path, unreadable/unparsable JSON, missing default export and unsupported extension; `validateConfig` collects all issues and `formatIssues` prefixes each with its path.
- Env overrides: `read` — `CRUST_DATA_DIR`, `CRUST_SIDECARS_DIR`, `CRUST_BRIDGE_URL`/`_TOKEN`, `CRUST_DEV`, `CRUST_LOG`, `CRUST_SINGLE_INSTANCE` and `CRUST_LOG_LEVEL` are documented operator overrides, not a config key silently replaced.
