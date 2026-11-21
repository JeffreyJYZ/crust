---
name: crust
description: You MUST use this when developing with crust — building, running, packaging or debugging a crust desktop app (Bun backend plus the system WebView, no Rust and no bundled Chromium). Covers crust init, crust.config.ts, main.ts commands, the window.crust page API, capability grants, window.capture and the testing namespace, and signed releases. Not for Tauri, Electron, or a plain web app with no native window.
---

# Building with crust

crust makes a desktop app out of Bun and the system WebView. No Rust, no bundled Chromium, no
native build step: the backend is TypeScript Bun runs, the frontend is a page the bridge serves,
and they talk over a loopback bridge with a bearer token. macOS 13+, Linux (GTK3 + WebKitGTK),
Windows (WebView2), x64 and arm64.

This file is the working surface: everything here is enough to build, run and verify an app. It is
not the full reference — when a table stops, the command reference is at
<https://crust.jyz.land/docs/reference/api>, one page per area and indexed by namespace. The docs
index is <https://crust.jyz.land/docs>.

## Quickstart

```sh
bunx github:JeffreyJYZ/crust#v0.2.11 init my-app   # plain HTML, no bundler
bunx github:JeffreyJYZ/crust#v0.2.11 init my-app --react   # also --next, --svelte, --vue, --solid
cd my-app && bun install
bun run dev        # crust dev
```

`brew install JeffreyJYZ/tap/crust` gives the same CLI on macOS, and `bun add -g github:JeffreyJYZ/crust#v0.2.11` installs that tag globally as `~/.bun/bin/crust` on any platform (`bun add -g crust` is a different, unrelated npm package — always name the `github:` specifier). Release binaries for all six platform/arch pairs are on the releases page; a bun global sits earlier on `PATH` than Homebrew's prefix, so where both exist the bun copy answers `crust`.

## What a scaffold is

| file | role |
| --- | --- |
| `crust.config.ts` | app identity, windows, security. The only required file. |
| `main.ts` | the backend: `app.command(...)`, `app.on(...)`, `await app.run()` |
| `public/` | what the window loads. `index.html` required. Served by the bridge itself. |

`--react` / `--svelte` / `--vue` / `--solid` / `--next` replace `public/` with a Vite or Next frontend
and add `dev.url`, so `crust dev` runs your dev server and points the window at it. `--solid` is Vite
plus Solid 2, not SolidStart: Solid 2 retired it, and `dev.url` wants one SPA on one origin.

## `crust.config.ts`

```ts
import type { CrustConfig } from "crust";

export default {
  app: { id: "land.jyz.myapp", name: "My app", version: "0.1.0" },
  windows: [{ label: "main", url: "/", width: 900, height: 640, title: "My app" }],
  security: {
    capabilities: [{ name: "app", actions: ["app:greet"] }],
    grants: { main: ["app"] },
  },
} satisfies CrustConfig;
```

### `app`

| key | default | notes |
| --- | --- | --- |
| `id` | required | reverse-DNS. Seeds the bridge port and is the notification identity |
| `name` | required | also the bundle name: `name.app` |
| `version` | required | `CFBundleShortVersionString` |
| `icon` | unset | **PNG**, resolved from the project dir. macOS converts to `.icns`; other platforms carry the PNG |
| `activate` | `"always"` | `"always"` / `"first"` / `"never"` — when a window create brings the app forward |

### `windows[]`

`label` (required, the handle every `window` command uses), `url` (default `/`), `width` 1100,
`height` 760, `minWidth`, `minHeight`, `title`, `material` (`"none"`; vibrancy/mica/acrylic/tabbed).

### `testing`

`activation` — `"auto"` (default: an ordinary launch), `"none"` (never activates at launch, and
`accessibility.elementCount` answers `needs-activation`) or `"on-demand"` (activates once for the
first accessibility read that needs it). Page-level `testing.*` and `window.capture` work in all
three, so a probe sees and drives a page without stealing focus. Pair with
`invoke("window", "create", { label: "probe", activate: false })`, which shows a window without
making it key.

### `dev`

`url` — one dev-server origin every window loads verbatim; `windows[].url` is then ignored and that
origin becomes the one extra origin the bridge allows. `beforeDevCommand` — started, not awaited.
Vite needs `strictPort: true`, or a moved port makes every invoke `bad-origin`.

### `build`

`assets` (`"public"`) — the directory embedded, must hold `index.html`; `beforeBuildCommand` — run to
completion, a non-zero exit aborts the build; `minimumSystemVersion` (`"13.0"`); `urlScheme`; and
`sidecars` — executables copied beside the binary at `0755` that `sidecar.spawn` may run.

### `security` — read this one carefully

```ts
security: {
  capabilities: [{ name: "fs", actions: ["fs:*"] }, { name: "app", actions: ["app:greet"] }],
  grants: { main: ["app", "fs"], admin: ["app"] },
}
```

- **Absent or empty `capabilities` allows every command.** That is the compatibility guarantee.
- **Present and non-empty denies by default.** A label with no `grants` entry holds nothing, and
  each namespace a page calls needs its own `capabilities` entry with the actions it may use plus
  that capability in the label's `grants` — granting one namespace does not grant another.
- An action is `plugin:command` with `*` as the only metacharacter: `fs:*`, `dialog:openPanel`.
- App commands can be narrowed: `app:<name>` (e.g. `app:notes.save`). `app:invoke` is the broad
  alias that grants every app command, present and future — useful while sketching, wrong in a
  shipped app.
- **The grant belongs to the window label bound to the token when its document was served.** A page
  writing `"window": "admin"` in its own invoke body can address that window but cannot hold its
  grants.
- This is authorisation, not a sandbox. A label holding `fs:*` reaches every path `fs` can.

`fs.scope` (absolute prefixes), `shell.allow` (program allowlist), `shell.cwdRoot`, `updater.pubkey`
(base64 of 32 raw bytes) and `updater.endpoint` narrow a plugin's reach. Narrow there, not here.

**Reaching an external service needs a CSP entry.** A built app serves `connect-src 'self'`, so a page's
`fetch`, `WebSocket` or `EventSource` to a provider is refused — while the same call works in `crust dev`,
which sets no policy and only warns about the difference. `security.csp` replaces the whole policy
(`connect-src 'self' https://api.example.com wss://api.example.com`); a single-file app declares it as one
`crust-security:` JSON line, `//` in a module or `<!-- -->` in `.html`. Microphone capture needs nothing
beyond `security.microphone`.

## `main.ts`

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${typeof name === "string" ? name : "there"}`);

app.on("ready", () => console.log("window open"));
app.on("window-all-closed", () => app.quit());

await app.run();
```

| export | signature |
| --- | --- |
| `app` | the singleton, inert until a platform and config attach |
| `app.command(name, handler)` | `(args) => unknown \| Promise<unknown>`. Throw or return; both reach the page |
| `app.use(plugin)` | register a `PluginDefinition` |
| `app.on(event, listener)` | `ready`, `window-all-closed`, `activate`, `before-quit`, `will-quit`, `reopen`, `error` |
| `app.invoke(name, args)` | call your own command in-process |
| `app.quit()` | end the app |
| `app.run()` | start. `command`/`use` throw after this |
| `createApp(platform, config)`, `loadConfig`, `validateConfig`, `definePlugin` | also exported |

Handlers run on the pump thread, so keep them fast. An async handler is awaited and does not block.

## Built-ins and capabilities

These are the built-in namespaces: each registers before your code runs, as do `app` and
`single-instance` — with four exceptions, so no count in prose can stay true. `updater` registers
only when the config has an `updater` section, and `pty` only when it has a `pty` one (so `pty` is
absent from the list below, which is generated without a config); `testing` only when the process
starts with `CRUST_TEST=1`; and a non-empty `plugins` array narrows the built-ins to exactly the
names it lists (`app` and anything mounted with `app.use` always register). `app.use` is only for
your own plugins, never a built-in, so a page may call `store.get` with no registration step.

`pty` is a real terminal a page drives: `pty: {}` in the config registers it, `{ shell }` picks the
one program it may run (absent is the login shell, and `open`'s `program` is accepted only when it
resolves to that same one), and a window label needs the `pty:open` action — a `shell` grant never
implies it. Commands are `open/write/resize/close/list`; output arrives as `pty-data` events whose
`chunk` is **base64** (decode to bytes, never to text), and `pty-exit` carries the child's own code
and signal. macOS and Linux run it over `Bun.Terminal`; Windows runs it over a ConPTY
pseudo-console, with `pty.shell` (`cmd.exe` by default) as the program.

A namespace still needs its own capability and grant before a page may call it — see `security`
above. For `store.get`:

```ts
security: {
  capabilities: [{ name: "store", actions: ["store:*"] }],
  grants: { main: ["store"] },
}
```

Without the `main` grant the same call returns `forbidden`.

## The page side

```js
await window.crust.ready;
const answer = await window.crust.invoke("greet", { name: "Ada" });   // routes to app.invoke
const files  = await window.crust.invoke("fs", "list", { path: "." }); // plugin:command form
```

**App commands are never called through the `app` namespace.** `invoke("greet", args)` is the only
form: the client turns it into `app.invoke { name: "greet", args }`, and the grant resolves as
`app:greet`. `invoke("app", "greet", args)` addresses a namespace named `app` that has no such
command, so it answers `unknown-command` — and a grant of `app:greet` would not authorise it either.

- `window.crust` is injected by the bridge. **Never import crust in page code** — two clients.
- A refused command rejects with a `code`. A command answering a typed failure
  (`{ ok: false, code }`) resolves with it and the transport carries a 4xx/5xx.
- `window.crust.a11y.pageTree(selector)` returns `{ nodes }` — each
  `{ role, label, focusable, readingOrder }` — the DOM's view, not the OS accessibility tree.
  `focusElement(selector)` answers `{ active: { role, label } }`, what actually took focus.
- In `next dev` there is no `window.crust`, because nothing injects the client into a document the
  Next dev server serves. A built app works.

## Plugin namespaces

<!-- skill:commands:begin -->
- `accessibility` — trusted prompt elementCount announce title focus
- `autostart` — enable disable isEnabled
- `browser` — open navigate state setBounds close capture
- `clipboard` — read write readImage writeImage
- `crash-reporter` — last list report configure clear install uninstall
- `database` — open close exec query get
- `deep-link` — scheme url
- `dialog` — openPanel savePanel cancel
- `dock` — badge badgeLabel bounce progress
- `downloads` — list start cancel directory setDirectory
- `findinpage` — search next previous clear
- `fs` — readTextFile writeTextFile list stat remove rename readBinary writeBinary mkdir scopeList
  scopeAllow scopeRevoke
- `i18n` — locale setLocale messages translate load
- `keychain` — set get delete list
- `logging` — setLevel level configure write tail
- `menu` — setAppMenu showContext reset read isDefault
- `navigation` — start stop state reload goBack goForward loadUrl
- `network` — status onChange rules setRules log clearLog
- `notification` — requestPermission notify
- `opener` — openPath openUrl revealItem
- `os` — info paths locale
- `positioner` — center topLeft topRight bottomLeft bottomRight topCenter bottomCenter leftCenter
  rightCenter
- `power` — state idleSeconds sleepPrevent sleepAllow onSleep onLock onWake onScreenSleep
  onScreenWake onUnlock
- `preview` — show hide
- `screen` — list primary
- `shell` — spawn output write close kill list
- `shortcut` — register unregister unregisterAll isRegistered list
- `sidecar` — spawn write list kill
- `store` — get set delete keys clear save
- `stronghold` — open close set get delete keys
- `theme` — current set reset
- `tray` — setTitle setTooltip setMenu show hide destroy
- `window` — create close focus setTitle list isOpen label setSize getSize setPosition getPosition
  setAlwaysOnTop isAlwaysOnTop setFullscreen isFullscreen minimize unminimize isMinimized maximize
  isMaximized setDecorations isDecorated setOpacity opacity setCursor setCursorVisible capture
- `window-state` — save restore forget saveAll restoreAll forgetAll
<!-- skill:commands:end -->

Each has commands with documented args, answers and failure codes — `fs.readBinary`,
`tray.setTooltip`, `power.onSleep`, `updater.install`. A capability must grant the namespace before a
page may call it (see above). Every command is `invoke("<namespace>", "<command>", { args })`. The
eight a first app reaches for are below — names and arg shapes only; answers and codes live in the
/reference/api pages linked at the top.

| namespace | commands → args |
| --- | --- |
| `store` | `get {key,name?}` · `set {key,value,name?}` · `delete {key,name?}` · `keys`/`clear`/`save {name?}`. `name` picks a separate `store.<name>.json`; omit it for the default store |
| `fs` | `readTextFile {path}` · `writeTextFile {path,contents}` · `list`/`stat`/`readBinary {path}` · `writeBinary {path,bytes}` · `mkdir {path}` · `remove {path,recursive?}` · `rename {from,to}` · `scopeList` · `scopeAllow`/`scopeRevoke {path}` |
| `dialog` | `openPanel {title?,multiple?,directory?,filters?}` · `savePanel {title?,suggestedName?,filters?}` · `cancel`. `{paths: []}` means the user cancelled |
| `window` | `create {label,title?,width?,height?,url?,activate?}` · `list` · `label` · `close`/`focus`/`isOpen`/`minimize`/`unminimize`/`isMinimized`/`maximize`/`isMaximized`/`isDecorated`/`opacity`/`getSize`/`getPosition`/`isAlwaysOnTop`/`isFullscreen {label}` · `setTitle {label,title}` · `setSize {label,width,height}` · `setPosition {label,x,y}` · `setAlwaysOnTop`/`setFullscreen`/`setDecorations`/`setOpacity {label,value}` · `setCursor {cursor}` · `setCursorVisible {value}` |
| `notification` | `notify {title,body?,id?,waitMs?}` · `requestPermission` |
| `clipboard` | `read` · `write {text}` · `readImage` · `writeImage {png}` |
| `shell` | `spawn {program,args?,cwd?,env?,stdin?}` (`stdin: "pipe"` to feed it) · `output`/`close`/`kill {id}` · `write {id,data}` · `list` |
| `tray` | `setTitle`/`setTooltip {text}` · `setMenu {items:[{label,onClick?}]}` · `show`/`hide`/`destroy` |

### `keychain` on ad-hoc builds

An ad-hoc signed macOS bundle has no `application-identifier` entitlement, so the OS refuses
`keychain.set` with `handler-error`. A later `get` answering `found: false` then means "nothing was
stored", not "nothing stored yet" — check the answer of `set`. There is no framework-level plaintext
fallback: use `stronghold` for a secret an ad-hoc build must keep. Windows and Linux have no such
entitlement. `service`/`account` may not contain a NUL (nor a backslash on Windows); `secret` may be
empty but not NUL-bearing.

## CLI

| command | does |
| --- | --- |
| `crust init <dir> [--react\|--next\|--svelte\|--vue\|--solid]` | scaffold into an empty directory |
| `crust dev [file]` | watch the backend, restart on change, keep the frontend's own dev server |
| `crust build [file]` | compile; **macOS** assembles `X.app` in `dist/` and ad-hoc signs it. Linux/Windows produce the flat binary. `--sign --notarize --dmg` add the release stages in that order |
| `crust package --format <fmt>` | release artefacts: `dmg`, `appimage`, `nsis`; repeatable, defaults to `dmg` |
| `crust doctor` | one line per launch check, exit 1 on any failure |

`--dir <path>` and `--config <path>` work on all of them.

`crust sign`, `crust dmg` and `crust notarize` are gone — each prints `crust: unknown command "<verb>"`. Use the `crust build` stages in order: build → ad-hoc sign → `--sign` → `--notarize` → `--dmg`. `--notarize` needs `--sign`; the dmg is built from the stapled app and is not itself notarized.

## Validate an app

There is no `report` command: evidence is the doctor's lines, the build's exit code, and the
process's own stdout. Check in that order — each layer answers a question the one before cannot.

**`crust doctor`** prints `crust doctor — <dir>` and then one aligned line per launch check, in the
order a failure happens: `  <name>  [ok|fail|note] <detail>`. The names are `platform` (macOS x64 or
arm64), `bun`, `config` — or the single file that needs none — `macos` against
`build.minimumSystemVersion`, `shim` (the C shim compiled with `cc()` exactly as launch compiles it),
`bridge` (the app's own derived port bound and one invoke answered `pong`, then released), `dev port`
/ `dev url` only when `dev.url` is set, `backend` (`src/main.ts`, else `main.ts`), `dev watch` for a
page written as `.ts` when `dev.url` is set, `single` for a single file's page bundle, `window` (the
platform module imported), `source` (one line when the trap scan is clean, or a `trap` line per
fatal pattern in your own source), `assets` (what a build would embed), `templates`, and `bundle`
with `gatekeeper` when a `.app` is in `dist/`. After those lines comes the `extensions` block: the
compilers, then a verdict per native source file, or one line when the project has no `native/` dir.
Exit 0 ends `all checks passed`; any `[fail]` ends `N checks failed` on stderr with
exit 1. It needs no build: with nothing in `dist/`, `bundle` is a `[note]` telling you to run
`crust build` first. A red line is the check that refused, in its own words — a `bridge` note about a
busy port means the page origin moves and origin-scoped storage does not follow, and a red `assets`
line names the missing directory and the command that should produce it, which is the blank window's
usual cause.

**`crust build`** is the second layer, and its exit code is the verdict: `0` after lines for
`assets`, `binary`, `app`, `sign` and `gatekeeper`, or `1` with `crust build: <reason>` on stderr
naming the thing to fix — a missing `app.icon`, no backend entry, a frontend command that failed.
macOS assembles `dist/<app.name>.app` around the compiled binary and ad-hoc signs it, printing
`sign  ad-hoc (codesign --sign -)` and `gatekeeper  refused on another machine until a Developer ID
signature exists`: a build that runs here is not yet a build that runs for a recipient. Linux and
Windows produce the flat `dist/crust-app` (`crust-app.exe` on Windows) and print
`sign  none — codesign is macOS-only`.

**Run the binary, not `open`.** The build's closing line suggests `open <path>`, but `open` goes
through LaunchServices: it can raise a Gatekeeper dialog and it never tells you which process ran.
Launch the executable inside the bundle instead — `dist/<app.name>.app/Contents/MacOS/crust-app` on
macOS, the flat binary elsewhere — and keep its stdout, because that is the only output you get.

**The round trip is the proof.** Both directions work when a handler's line appears after a page
call. `examples/hello/main.ts` prints this for one window and one `invoke("greet", { name })`:

```
  window    Hello crust is open — 900x640
  greet     hello Ada (page call answered)
```

`window` means the window mounted and `ready` ran; `(page call answered)` means the page's
`window.crust.invoke` crossed the bridge, reached the handler and came back. A window with no such
line means the call never left the page or was refused — read that as transport, not as a rendering
fault.

**What a failure looks like.** The codes below are the bridge's vocabulary, and a refusal rejects
with one rather than failing silently. `forbidden` is the first a new app meets: a namespace the
page calls needs both an action and a `grants` entry for that window's label (`security` above says
why). `bad-origin` is the second: `dev.url` without `strictPort` moves the port under a running
page.

**The run's own record is on disk.** crust logs the run itself — app and window lifecycle, every
invoke with `durMs` and a `code`, page console and errors — as JSON lines in
`~/Library/Application Support/<app.id>/logs/app.jsonl`, rotating into `app.1.jsonl`… and keeping
`warn` and above in `errors.jsonl`. Your own code writes to the same file with `import { log } from
"crust"` and `log.info("sync finished", { files: 12, ms: 340 })` — the fields land as JSON, `source`
is `app`, and the configured level filters it like any framework line. Read the tail from the page
with `window.crust.invoke("logging", "tail", { level, source, since, limit })`, or let `crust dev`
stream lifecycle and refusals to the terminal — it starts at `info`, and the level is `--log-level
debug` for one run, `CRUST_LOG=debug` for a shell, or `logging.level: "debug"` in `crust.config.ts`;
`debug` adds a line per invoke.

## Test an app

Past the round trip, two surfaces let an agent see and drive the page it built without touching the
machine.

**`window.capture { label }`** answers `{ ok, label, width, height, scale, png }`. `png` is base64
with no `data:` prefix, and `width`/`height` are page pixels — the point size times `scale`, so a
900×640 window on a Retina display comes back 1800×1280 at `scale: 2`. It is the webview's own
render, never the display: no Screen Recording grant is asked for and none is needed, and a platform
whose webview cannot render a picture answers `not-implemented` naming the API rather than falling
back to a screenshot of the screen.

**`browser.capture { label }`** is the picture of an embedded browser surface, which `window.capture`
cannot see: the surface is a native sibling view, so it is missing from the app's own webview render.
It answers `{ ok, width, height, scale, png }` at the surface's page pixels — an unknown label is
`not-found`. `capture` is macOS-only: WebView2 needs an `IStream` for `CapturePreview` and WebKitGTK's
`get_snapshot` answers a cairo surface, so both name the call instead of screenshotting the screen. The
surface itself works on all three.
The embedded page carries no bridge token and no `window.crust`.

**`testing`** drives that same page. Every command takes `label` too — omitted means the app's first
open window.

| command | args → answer |
| --- | --- |
| `click` | `{ selector }` → `{ ok, clicked }` — scrolls into view, focuses, then clicks |
| `clickAt` | `{ x, y }` → `{ ok, clicked }` — whatever `elementFromPoint` finds there |
| `type` | `{ selector, text }` → `{ ok, value }`, the field read back |
| `key` | `{ key, modifiers? }` → `{ ok, key, modifiers, target }`, `target` being the tag it reached |
| `hover` | `{ selector }` → `{ ok, hovered }` — `mouseover` then `mousemove` at its centre |
| `query` | `{ selector }` → `{ ok, exists, visible, rect, text, value, attributes }` |
| `waitFor` | `{ selector, timeoutMs? }` → `{ ok, found, waitedMs }`, 5000 ms by default |
| `console` | `{ since? }` → `{ ok, hooked, entries }`, each entry `{ level, args, at }` |

A selector that matches nothing is `not-found` — except in `query`, which answers `exists: false`
instead, so `query` is the call when the absence is the finding. `value` is `null` for an element
with no value, keeping `""` distinguishable. `console` reads what the bridge's page-world tap
recorded from document start, filtered by millisecond `since`; a page without that tap answers
`not-implemented` rather than `[]`.

Two caveats decide whether a run is real. **`testing` exists only when the process starts with
`CRUST_TEST=1`** — otherwise the namespace is not registered and every call answers `unknown-plugin`,
which is the point: a shipped build cannot be driven. And it **drives the page with DOM events, not
OS input**, so nothing moves a cursor and no Accessibility grant is involved; a synthetic `key` is
one `KeyboardEvent` the page sees and no browser default follows it, so `key: "Enter"` submits
nothing.

Those commands never need the app active, but the launch does by default. Set `testing.activation`
in `crust.config.ts` to `"none"` (never activates; an AX read answers `needs-activation`) or
`"on-demand"` (activates once for the first AX read that needs it), and open any window a probe makes
itself with `activate: false`, so a run never takes the human's front.

That is also why `type` does not assign `.value`. A plain assignment leaves a framework's tracker
holding its own copy of the value, so React sees no change, re-renders nothing, and the test passes
over a stale field. `type` calls the prototype's value setter — under the tracker — then dispatches a
bubbling `input` event, and answers the field's own value read back after it.

A run is a few calls and a second look:

```js
await window.crust.invoke("testing", "waitFor", { selector: "#save" });
const before = await window.crust.invoke("window", "capture", { label: "main" });
await window.crust.invoke("testing", "type", { selector: "#title", text: "Ada" });
await window.crust.invoke("testing", "click", { selector: "#save" });
const status = await window.crust.invoke("testing", "query", { selector: "#status" });
const after = await window.crust.invoke("window", "capture", { label: "main" });
```

`status.text` is what changed; the two `png`s are what the page looked like. Capture one at a time —
a second capture supersedes an unanswered first, and one WebKit does not answer within 5 s fails
rather than hangs. Once `security.capabilities` is present both namespaces need their own action and
grant: `window:*` for `capture`, `testing:*` for the rest.

## Failure codes

`unauthorized` (401), `forbidden` (403, capability refused), `bad-origin`, `not-found`,
`unknown-plugin`, `unknown-command`, `bad-json`, `bad-request`, `handler-error`, `too-large`,
`not-implemented`, `outside-scope` (403, an `fs` path resolving outside every `fs.scope` prefix).
`shell` answers a typed `{ ok: false, code, message }` value instead of rejecting, with its own
codes (`program-not-allowed`, `program-outside-root`, `cwd-not-allowed`, `env-not-allowed`, and
others).

## Gotchas that cost time

- **`forbidden` is a missing grant, not a bug** — add the namespace's capability to that window
  label's `grants`; `security` above has the rule.
- **`dev.url` must be `strictPort`.** A port move is `bad-origin` on every invoke.
- **`app.icon` is a PNG**, not SVG/ICO. A missing file fails the build by name.
- **Builds are host-only.** `crust build` has no `--target`; the release workflow builds the other
  platforms.
- **Only macOS gets an `.app` and signing.** Off darwin the product is `dist/crust-app(.exe)`, and
  the updater refuses `unsupported-platform`.
- **A window's URL must be same-origin as the bridge** unless `dev.url` names it. Absolute foreign
  origins are refused.
- **`bun test` in your app is yours, not crust's** — crust's own suite is not part of your project.
- **`security.microphone` grants capture in a built macOS bundle only** — `crust dev` denies
  `getUserMedia` because an unbundled run carries no purpose string, and Windows and Linux deny it
  today; test capture in a `crust build` app.

## Full reference

`/docs/start/first-app`, `/docs/reference/config`, `/docs/reference/api` (the namespace index: the
command reference runs one page per area — `api-app`, `api-desktop`, `api-fs`, `api-ui`,
`api-updater`, `api-web`, `api-window`), `/docs/reference/errors`, `/docs/guides/*` (one guide per
plugin), `/docs/limits` (what crust does not do, stated before you build on it).
