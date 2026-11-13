# crust

A Bun-native desktop app framework. Matches Tauri's shape — system webview, no
bundled Chromium, small cold start — without a Rust toolchain and without
shipping a compiled native artifact.

**No Rust. Just crust.**

macOS arm64 only for v1. The full design, with every measured number and its
command, is in [DESIGN.md](DESIGN.md).

---

## Status

`crust dev` runs a real app: one `NSWindow` with a `WKWebView`, a loopback
bridge serving the page, and a typed `invoke` path from the page into Bun code.
`crust build` compiles that app and assembles `X.app`, ad-hoc signed. The
example in `examples/hello` is the whole path end to end.

`crust init <dir>` scaffolds an app from `templates/default/`. A built app
embeds the whole `public/` tree — separate JS, CSS, fonts and images included —
and serves a path with no extension from `index.html`, so a client-side route
works.

What is still missing: Windows and Linux, Developer ID signing, and the
`dialog`, `tray` and `notification` plugins.

## Start an app

The only requirement is Bun. From anywhere:

```sh
bunx github:JeffreyJYZ/crust init my-app
cd my-app
bun install
bunx crust dev
```

From a crust checkout, the same thing through `bun run src/cli/index.ts init
my-app`, which pins the dependency as `link:<checkout>` so a local edit is picked
up without republishing. A scaffold made through `bunx` or a registry install
pins `github:JeffreyJYZ/crust` instead, because the directory `init` runs from is
a cache path that will not survive.

`crust init` writes `crust.config.ts`, `main.ts`, `public/index.html`,
`public/style.css`, `public/app.js`, `.gitignore` and a `package.json` whose
`dev` and `build` scripts call `crust`. The files are copied from
`templates/default/`, and a directory that is not empty is refused with the
entries it found rather than overwritten.

## Run the example

From the crust checkout:

```sh
bun install                      # one dev dependency: @types/bun
bun run src/cli/index.ts dev --dir examples/hello
```

There is nothing to build and nothing to install globally. The example is five
files: `crust.config.ts`, `main.ts`, `public/index.html`, `public/style.css` and
`public/app.js` — plain HTML with separate CSS and JS, no bundler.

What you get:

- a 900×640 window titled by the page as **Hello crust**, on a dark canvas
- the page calls `window.crust.invoke("greet", { name: "jyz" })` and renders
  **hello jyz** underneath the heading
- the terminal prints the bridge URL, `greet hello jyz (page call answered)`
  and `window Hello crust is open — 900x640`

Close the window and the app exits; `crust dev` exits 0 with it. Edit
`examples/hello/main.ts` and the runtime process restarts. A change under
`public/` restarts nothing — the bridge serves that file fresh on the next page
load, and a real dev server's HMR owns its own frontend.

The window title is applied from C: config `title` goes through a shim function
that builds the `NSString` on the native side, because a short ASCII `NSString`
is a tagged pointer that cannot cross `bun:ffi` (DESIGN.md §2). The window reads
back `Hello crust`, and a mismatch throws rather than silently staying blank.

## Build the example

```sh
bun run src/cli/index.ts build --dir examples/hello
open "examples/hello/dist/Hello crust.app"
```

`crust build` compiles a generated entry that embeds the config, the backend
`main.ts`, **every file under `public/`**, **and the C shim as text** — inside a
compiled binary `import.meta.dir` is `/$bunfs/root`, so the shim is written to a
temp file at launch before `cc()` runs — then assembles the bundle and ad-hoc
signs it: 85.11 MiB binary, 85.12 MiB bundle for this example.

Running the binary inside the bundle directly, never `open` (which routes through
LaunchServices and Gatekeeper):

```
$ "examples/hello/dist/Hello crust.app/Contents/MacOS/crust-app"
  bridge    http://127.0.0.1:63151
  window    Hello crust is open — 900x640
  greet     hello jyz (page call answered)
EXIT=0
```

The bundle is the shipping unit: a bare executable is not double-clickable, and a
quarantined one is killed by the kernel with no message.

## The config surface

`crust.config.ts` (or `crust.json`, same object):

```ts
import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.example", name: "Example", version: "0.1.0" },
	windows: [{ label: "main", url: "/", width: 1100, height: 760, title: "Example" }],
	dev: { url: "http://localhost:5173", beforeDevCommand: "bun run dev" },
	plugins: ["crust:fs"],
} satisfies CrustConfig;
```

`dev.url` points the window at an existing dev server instead of the bridge;
`beforeDevCommand` is started (not awaited) by `crust dev`. Without `dev.url`,
the bridge serves `public/index.html` and injects its own token, which is the
path the example takes.

Every key is validated at startup; a bad config names the key and the shape it
expected, e.g. `windows[0].width — expected a positive integer, got "wide"`.

## The app surface

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${name}`);
app.on("ready", () => console.log("windows open"));
await app.run();
```

Five members: `command`, `on`, `run`, `quit`, `invoke`. The page calls a command
by name (`invoke("greet", { name })`); plugin commands use the three-argument
form (`invoke("fs", "readTextFile", { path })`). An unknown name returns the
bridge's structured error to the page — a rejected promise with `code` and
`message` — never a process crash.

`app.run()` needs no manual wiring. Called through `crust dev` or a built app
the platform, config and bridge are attached first; called bare
(`bun src/main.ts`) it loads the config from the working directory and imports
the macOS platform on demand, so no window code is linked into a process that
never opens one.

## The numbers

Measured on this machine, Bun 1.4.4, macOS 27.0.1, arm64 (DESIGN.md §1 and §10,
`research/`):

- **Size — 85 MiB.** The compiled binary for `examples/hello` measured
  **85.08 MiB** (89,209,442 bytes), the assembled `.app` **85.09 MiB**
  (89,219,072 bytes). A bare hello-world is 89,159,906 bytes (85.03 MiB); adding
  three thousand functions moved it 161 KiB. `--trim` is a no-op on stable 1.4.4.
- **Window visible — 299.5 ms** after process start, measured at `isVisible=1`
  on the spike's 1100×760 window. `WKWebView` alloc+init alone is 165 ms.
- **Page painted — 925.2 ms** after window creation, measured as the page's own
  report arriving at the server. Most of that is WebKit's web-process launch.
- **Cold start — median 5.76 ms** for the whole process on the compiled binary,
  **4.37 ms to a listening `Bun.serve`**, measured without a webview.
- **IPC — 0.119 ms median, 1.276 ms p99** over 200 invoke round trips; a reused
  connection is 0.045 ms.

The honest size claim is **"no bundled Chromium"**, never "as small as Tauri":
Tauri's floor is 3–8 MB because it ships no JavaScript engine. That is the
runtime, not your app, and it is the accepted cost of shipping neither Rust nor
Chromium.

## Limits, stated plainly

- **macOS arm64 only.** Intel Macs, Windows and Linux are not supported.
- **Ad-hoc signing only.** `codesign --sign -` works locally; `spctl` rejects
  it (exit 3) and it cannot be notarized, so Gatekeeper refuses the app on any
  other machine. Recipients run `xattr -dr com.apple.quarantine "Hello
  crust.app"` or right-click → Open. A Developer ID is `crust sign`'s job and
  needs a certificate this repository does not ship.
- **A built app embeds the whole `public/` tree.** `.html`, `.js`, `.css`,
  `.json`, `.svg`, `.png`, `.woff2` and `.wasm` are served with their own content
  types, and a path with no extension falls back to `index.html` so a
  client-side route works. A frontend that a dev server builds outside `public/`
  still needs its own build step.
- **`fs` is the only working plugin.** `dialog`, `tray` and `notification`
  answer with a structured `not-implemented` error naming what they require.
  Scripts also cannot be evaled from the page: no `dialog`.
- **A blocking JavaScript call blocks drawing.** The Cocoa run loop is pumped
  from a timer (16 ms tick, 0.25 ms slice); long synchronous work belongs on a
  `Worker`.

## Layout

```
src/app.ts          the app surface: command, on, run, quit, invoke, + the Platform seam
src/runtime.ts      startApp: config + bridge + platform + the user's main.ts
src/config/         crust.config.ts / crust.json loading and validation
src/bridge/         loopback invoke + SSE bridge, and the page-side client
src/cli/            dev, build, sign, dmg, doctor
src/packaging/      binary compile, .app assembly, signing, dmg, icon
src/plugins/        definePlugin and the four v1 plugins
src/platform/       the macOS implementation (shim.c compiled at launch by cc())
templates/default/  the app `crust init` copies
examples/hello/     the minimal app this README runs
```
