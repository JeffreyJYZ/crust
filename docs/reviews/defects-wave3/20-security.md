# Cross-cutting security — bridge, plugins, platform trust boundary

## Findings

### 1. The bearer token is served to any caller of the token-free document route — HIGH
`src/bridge/server/handler.ts:43-55`
The only credential the bridge accepts (`token`) is injected into the HTML that the handler serves without any token, before the origin and token checks run. Any local process can `GET http://127.0.0.1:<port>/`, read the token out of the inline bootstrap, and then invoke every registered command — shell spawn, arbitrary file read/write, window control. The file header claims "the token is what actually protects the bridge"; it protects nothing against the local-process threat it names.
**Breaks:** the bridge's stated trust boundary; any unprivileged local process can drive the app's native commands by fetching a public document.
**Evidence:** `src/bridge/server.ts:3` — "Loopback is reachable by any local process, so the token is what actually protects the bridge." vs `src/bridge/server/handler.ts:43-55` document branch before any auth, and `src/bridge/server/assets.ts:85` — `token,` inside the config serialised by `src/bridge/client/bootstrap.ts:38` — `Object.assign({ window: … }, ${JSON.stringify(config)})`. `src/bridge/server-document.test.ts:44` asserts `expect(document).toContain(bridge.token)`.

### 2. Windows asset route: backslash traversal escapes the asset root — HIGH (Windows, dev)
`src/bridge/server/assets.ts:31-43`
`assetBody` rejects `..` only by splitting on `/`. A path whose `..` segments arrive encoded as `%5C` (backslash) decodes after the URL parser has run and passes the check; on Windows `join(root, relative)` treats `\` as a separator, so `join(root, "..\\secret")` reads outside the asset root. The route is token-free, so no credentials are needed. Reachable when a filesystem `root` is configured (`crust dev` sets it to `<project>/public` in `src/runtime.ts:47`); a built app serves embedded assets and has no such root.
**Breaks:** arbitrary file read from outside the app's frontend root on Windows by a local request such as `GET /%2e%2e%5csecret` or `/a%5c..%5c..%5csecret`.
**Evidence:** `src/bridge/server/assets.ts:32` — `if (key.includes("\0") || key.split("/").some((part) => part === ".."))` then `src/bridge/server/assets.ts:42` — `const file = Bun.file(join(options.root, relative));`. Measured: `decodeURIComponent("/%2e%2e%5csecret")` → `"/..\\secret"`, `path.win32.join("C:\\root", "..\\secret")` → `C:\secret`.

### 3. Bridge token written world-readable to the project-root dev handshake — MEDIUM
`src/runtime.ts:127-130`
The per-launch bearer token is persisted with `writeFileSync` and no `mode`, so the file inherits the process umask (commonly 0644). Other local users can read the token and invoke every bridge command. The same file is written with an explicit 0600 nowhere, unlike the other secret stores in the repo.
**Breaks:** token disclosure to every local account on a shared machine in `crust dev`.
**Evidence:** `src/runtime.ts:129-130` — `JSON.stringify({ url: bridge.url, token: bridge.token })` with no `{ mode: 0o600 }`; contrast `src/plugins/store-file.ts:61` and `src/plugins/fs-scope-store.ts:31-33`, which both pass `mode: 0o600`.

### 4. Header claims an Origin check refuses an absent header; code allows it — LOW
`src/bridge/server.ts:3`
The security-posture docstring says "an Origin check refusing an absent header". `allowedOrigin` returns true for a null origin and a test asserts this behaviour. The stated posture misdescribes the gate a reviewer would rely on.
**Breaks:** readers auditing the trust boundary believe absent `Origin` is blocked, when it is explicitly allowed.
**Evidence:** `src/bridge/server.ts:3` — "an Origin check refusing an absent header" vs `src/bridge/server/cors.ts:47` — `if (origin === null) return true;` and `src/bridge/server.test.ts:53` — test title "an absent Origin with the right token is allowed: the token is the credential".

## Coverage

Read in full: `src/bridge/server.ts`, `server/{handler,cors,assets,http,invoke,events,types}.ts`, `src/bridge/window-identity.ts`, `src/bridge/client/{bootstrap,install,invoke}.ts`, `src/bridge/errors.ts`, `src/runtime.ts`, `src/app.ts`, `src/runtime-plugins.ts`, `src/plugins/{shell,shell-args,shell-resolve,shell-env,fs,fs-scope,fs-scope-path,fs-scope-store,downloads-scope,navigation,network,network-match,network-rules,network-types,opener,deep-link,updater-url,logging,stronghold-file,runtime-crash-store,crash-reporter,registry,window-label}.ts`, `src/config/{validate-security,validate-fs,validate-shell,validator,issues}.ts`, `src/vite.ts`, `src/cli/doctor/bridge.ts`, `src/platform/darwin/{window-create,webview-configuration,deep-link}.ts`, plus the relevant bridge tests.

Checked and found sound, not reported: shell uses `Bun.spawn` argv with no shell string and canonical allow-listed paths (`src/plugins/shell.ts:90`, `shell-resolve.ts:133`); `opener.openUrl` validates a scheme and `updater.download` allows only `https` (or opt-in `file`) (`opener.ts:150`, `updater-url.ts:29`); `fs` scope, downloads destination and shell `cwd` compare canonical paths with separator-aware prefixes (`fs-scope-path.ts:30`, `downloads-scope.ts:26`, `shell-resolve.ts:49`); `store-file`, `fs-scope-store`, `stronghold-file` and crash records all write 0600; no `console.*` call emits a token.

Not examined: the C shim sources under `src/platform/*/shim/`, the packaging/notarize credential path (`src/cli/notarize.ts`), `site/`, `templates/` and `examples/`; a reviewer with a Windows host should confirm the `%5C` traversal against a real `crust dev` root, and audit the crash-guard environment for inherited `CRUST_BRIDGE_TOKEN` (the token is set in `process.env` at `src/runtime.ts:132` and `shell.spawn` inherits `process.env` at `src/plugins/shell.ts:93`).
