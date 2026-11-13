# crust

A Bun-native desktop app framework. Matches Tauri's shape — system webview, no bundled Chromium, small cold start — without a Rust toolchain and without shipping a compiled native artifact.

**No Rust. Just crust.**

macOS 13 or later on Apple silicon for v1. The full design, with every measured number and its command, is in [DESIGN.md](DESIGN.md).

---

## Install

Three ways in, all detailed in [docs/install.md](docs/install.md) — what each one puts on disk, the bunx cache trap, and the troubleshooting table.

| you want | command |
| --- | --- |
| Homebrew, macOS arm64 | `brew install JeffreyJYZ/tap/crust` |
| nothing installed at all | `bunx github:JeffreyJYZ/crust#v0.1.5 init my-app` |
| a checkout you can edit | `bun install && bun run start` |

**Homebrew** merged into `JeffreyJYZ/homebrew-tap` on 2026-11-13 and currently installs `crust 0.1.5`: 95 files, 671.3 KiB (687,432 bytes), with `bun` pulled in as a dependency. It is a source install, not a bottle — `src/`, `templates/`, `docs/`, `package.json`, `tsconfig.json` and `DESIGN.md` go into `/opt/homebrew/Cellar/crust/0.1.5/libexec/`, the `README.md` the formula also lists is moved by Homebrew's metafile pass up to `/opt/homebrew/Cellar/crust/0.1.5/README.md`, and `/opt/homebrew/bin/crust` is a wrapper that execs the brewed `bun` on `libexec/src/cli/index.ts`. Nothing is compiled at install time: the shim compiles at launch, from the Cellar, and `crust doctor` is the check that it does. The formula's caveat asks for `xcode-select --install`, but measured, nothing needs it: the shim has no `#include` at all — every Objective-C symbol is a hand-written `extern` — and `cc()` compiled it with an empty environment, `PATH` holding only `bun`, and `SDKROOT=/nonexistent/sdk`. No compiler is ever executed either way, and the formula tracks the newest tag rather than `main`, so a brewed `crust` is exactly that release.

**bunx** needs Bun and nothing else — no `PATH` entry, no global install. Its one sharp edge is the cache: bunx keys on the specifier string, so a bare `github:JeffreyJYZ/crust` names no version and keeps serving whatever commit it first resolved. Measured on this machine, that bare spec and `#main` both answer `0.1.0`; one of those cached 0.1.0 commits refuses `--next` while a fresh cache answers `0.1.5` — a reader who sees `crust: unknown option --next` is on a stale cache, not a bug in crust, and two readers of this page can get different scaffolds. Name a tag (`github:JeffreyJYZ/crust#v0.1.5`, the one specifier whose answer cannot drift) or delete `~/.bun/install/cache/.bunx-501/crust@github@*` and `~/.bun/install/cache/@GH@JeffreyJYZ-crust-*`.

**From a checkout**, `bun install` pulls two dev dependencies (`@types/bun`, and `vite` for the React template's build) and `bun run start` is `bun run src/cli/index.ts`, so it takes every command and flag below: `bun run start dev --dir examples/hello`. A scaffold made there pins `crust` as `link:<checkout>`, so a local edit is picked up without republishing; every other install pins the bare `github:JeffreyJYZ/crust`, and `bun install` in the app resolves it to `main`'s head — a different commit from the tag the formula installed, and at the same version number.

## Status

`crust dev` runs a real app: one `NSWindow` with a `WKWebView`, a loopback bridge serving the page, and a typed `invoke` path from the page into Bun code. `crust build` compiles that app and assembles `X.app`, ad-hoc signed. The example in `examples/hello` is the whole path end to end.

`crust init <dir>` scaffolds an app from `templates/default/`; `--react` selects `templates/react/` and `--next` selects `templates/next/`. No flag is the plain one, and the two flags are different scaffolds, so passing both is refused with a message naming each. A built app embeds the configured asset directory — `public/` by default, a frontend's build output when `build.assets` names it (`dist/web` for React, `out/` for Next) — separate JS, CSS, fonts and images included, and serves a path with no extension from `index.html`, so a client-side route works.

All three scaffolds have been measured end to end, each built from a scaffold rather than from this checkout: plain **3 files from `public/`, 85.25 MiB binary**, React **2 files from `dist/web/`, 85.45 MiB**, Next **21 files from `out/`, 85.83 MiB and a page that answers `invoke("greet")`**. The Next numbers and the run behind them are in [docs/next.md](docs/next.md).

What is still missing: Windows and Linux, and Developer ID signing. `dialog`, `tray` and `notification` all exist; `dialog` and `tray` have adapters that do real work, and `notification` is entered inside a bundle and refused by the OS — see [Limits, stated plainly](#limits-stated-plainly).

## Start an app

The only requirement is Bun. Pick a scaffold by what you already have; the flag is the whole difference between them.

| you have | flag | command |
| --- | --- | --- |
| HTML and CSS, no bundler | none | `crust init my-app` |
| React, or a Vite frontend | `--react` | `crust init my-app --react` |
| Next.js on the app router | `--next` | `crust init my-app --next` |
| one component, just to see a window | no scaffold | `crust dev app.tsx` |

`crust` in that table is whichever install you chose above, so from anywhere with nothing installed the first scaffold is:

```sh
bunx github:JeffreyJYZ/crust#v0.1.5 init my-app
cd my-app
bun install
bunx crust dev
```

Inside the project, `bunx crust dev` runs the `crust` in `node_modules/.bin`, so the app runs the copy it pinned rather than the CLI that scaffolded it. Name a tag (`github:JeffreyJYZ/crust#v0.1.5`) if you want the release rather than `main`.

`crust init` refuses a directory that is not empty, naming the entries it found, rather than merging into it — nothing of yours is overwritten.

Four limits hold for all three scaffolds, and each one changes what you plan to build:

- **macOS 13+ on arm64.** Intel Macs, Windows and Linux are not supported.
- **85 MiB per app.** Bun ships its runtime inside the binary. That is the framework's floor, not your code: three thousand extra functions moved it 161 KiB.
- **Ad-hoc signing.** `codesign --sign -` opens the app on this machine and Gatekeeper refuses it on any other, so a recipient needs `xattr -dr com.apple.quarantine "my-app.app"`, or right-click → Open.
- **`notification` is refused inside a bundle.** The call is entered and the callback fires with `granted = false`; the cause is still unidentified, and no fake success is reported. Every per-plugin measurement is in [Limits, stated plainly](#limits-stated-plainly).

### Plain HTML — the default

```sh
bunx github:JeffreyJYZ/crust#v0.1.5 init my-app
cd my-app
bun install
bunx crust dev
bun run build             # crust build → dist/my-app.app
```

`templates/default/` is seven files: `crust.config.ts`, `main.ts`, `public/index.html`, `public/style.css`, `public/app.js`, `.gitignore` and a `package.json` whose `dev` and `build` scripts call `crust`. Separate CSS and JS with no bundler — the bridge serves `public/` itself and injects its own client, so an edit under `public/` shows on the next reload and nothing has to be built.

Verified on 2026-11-13 from an empty directory with no checkout present:

```
$ bunx github:JeffreyJYZ/crust#v0.1.5 init my-app
$ cd my-app && bun install
  + crust@github:JeffreyJYZ/crust#e0ce2a4
$ bunx crust dev
crust dev — /private/tmp/my-app/crust.config.ts
  frontend  served by the bridge (public/index.html, no dev server)

  bridge    http://127.0.0.1:49283
  window    open
  greet     hello crust (page call answered)
EXIT=0
```

That pin is the stale one, and it is what the run printed: `e0ce2a4` predates `--next`, which is why [docs/install.md](docs/install.md) says to name a tag when the cache has gone stale.

### React — `--react`

```sh
bunx github:JeffreyJYZ/crust#v0.1.5 init my-app --react
cd my-app
bun install
bunx crust dev            # Vite on :5173; the window loads it
bun run build             # vite build → dist/web, then crust build → dist/my-app.app
```

`templates/react/` is seven files: `package.json` (react, react-dom, vite, `@vitejs/plugin-react`), `vite.config.ts` (the react plugin plus `crust()` from `crust/vite`, port pinned to 5173, `outDir: "dist/web"`), `crust.config.ts` (`dev.url` on that port, `build.assets: "dist/web"`), `index.html` (the mount point and the module script), `src/main.tsx` (one component, inline styles, one `invoke("greet")` in an effect, dark by default and readable through `prefers-color-scheme`), `main.ts` (one command, `app.run()`), and `.gitignore`.

`src/main.tsx` calls `window.crust.invoke("greet", { name })` on mount, so a built app proves the whole path — window, embedded bundle, bridge, handler — with no click. Built from the scaffold on 2026-11-13: **2 files from `dist/web/`**, an 85.45 MiB binary, the page's call answered, exit 0.

### Next.js — `--next`

```sh
bunx github:JeffreyJYZ/crust#v0.1.5 init my-app --next
cd my-app
bun install
bunx crust dev            # `crust dev` starts `next dev -p 3000`; the window loads it
bun run build             # next build → out/, then crust build → dist/my-app.app
```

`templates/next/` is eight files: `package.json` (crust, next, react, react-dom, plus typescript and two `@types` for `next build`), `next.config.mjs` (`output: "export"`, `images.unoptimized`), `tsconfig.json` (annotated with the `next` plugin), `crust.config.ts` (`dev.url` on :3000 with `beforeDevCommand`, `build.assets: "out"`, the matching `beforeBuildCommand`), `app/layout.tsx` (the root layout, with the whole palette in inline styles and no stylesheet), `app/page.tsx` (`"use client"`, one `invoke("greet")` after mount), `main.ts` (one command, `app.run()`) and `.gitignore`.

**Static export is the whole mode.** crust ships one binary that serves files from its own loopback bridge and has no server, so anything needing a process to answer a request is out of scope: route handlers, middleware, ISR, `next/image` optimisation, Server Actions, request-time `cookies()`/`headers()`, and `next start`. Server Components still work — they run once, at `next build`, and their output is part of the export. [docs/next.md](docs/next.md) is the full list.

Measured on 2026-11-13, from a scaffold: `bun run build` ran `next build`, embedded **21 files from `out/`**, produced an 85.83 MiB binary, and the built app answered the page's `invoke("greet")` with the bridge serving the export from inside the bundle. Development differs from a built app: in `next dev` the page has no bridge client and says so (`window.crust is not installed in this page`), because the dev server serves that document and only a built app's bridge injects the client.

### One file — no scaffold

```sh
bunx github:JeffreyJYZ/crust#v0.1.5 dev app.tsx     # one 900×700 window
bunx github:JeffreyJYZ/crust#v0.1.5 build app.tsx   # → dist/app.app, ad-hoc signed
```

One TSX file, no `crust.config.ts` and no `main.ts`: crust builds the config in memory, bundles the page and serves it. A file whose source contains `export default` is mounted as a React component, so `react` and `react-dom` must be installed beside it; any other file is loaded for its own side effects. There is no backend of your own — `info` and `echo` are the app namespace, and every plugin is still reachable in the three-argument form. [docs/single-file.md](docs/single-file.md) is the whole contract, including what it deliberately lacks: HMR, watching imports, a config surface and your own commands. Add `crust.config.ts` and `main.ts` the moment you need any of those.

## Run the example

From the crust checkout:

```sh
bun install                      # two dev dependencies: @types/bun and vite
bun run src/cli/index.ts dev --dir examples/hello
```

There is nothing to build and nothing to install globally. The example is five files: `crust.config.ts`, `main.ts`, `public/index.html`, `public/style.css` and `public/app.js` — plain HTML with separate CSS and JS, no bundler.

What you get:

- a 900×640 window titled by the page as **Hello crust**, on a dark canvas
- the page calls `window.crust.invoke("greet", { name: "jyz" })` and renders **hello jyz** underneath the heading
- the terminal prints the bridge URL, `greet hello jyz (page call answered)` and `window Hello crust is open — 900x640`

Close the window and the app exits; `crust dev` exits 0 with it. Edit `examples/hello/main.ts` and the runtime process restarts. A change under `public/` restarts nothing — the bridge serves that file fresh on the next page load, and a real dev server's HMR owns its own frontend.

The window title is applied from C: config `title` goes through a shim function that builds the `NSString` on the native side, because a short ASCII `NSString` is a tagged pointer that cannot cross `bun:ffi` (DESIGN.md §2). The window reads back `Hello crust`, and a mismatch throws rather than silently staying blank.

## Build the example

```sh
bun run src/cli/index.ts build --dir examples/hello
"examples/hello/dist/Hello crust.app/Contents/MacOS/crust-app"
```

`crust build` compiles a generated entry that embeds the config, the backend `main.ts`, **every file under `public/`**, **and the C shim as text** — inside a compiled binary `import.meta.dir` is `/$bunfs/root`, so the shim is written to a temp file at launch before `cc()` runs — then assembles the bundle and ad-hoc signs it: 85.11 MiB binary, 85.12 MiB bundle for this example.

Running the binary inside the bundle directly, never `open` — that routes through LaunchServices and Gatekeeper, and it is not the launch path that reports exit 0:

```
$ "examples/hello/dist/Hello crust.app/Contents/MacOS/crust-app"
  bridge    http://127.0.0.1:63151
  window    Hello crust is open — 900x640
  greet     hello jyz (page call answered)
EXIT=0
```

The bundle is the shipping unit: a bare executable is not double-clickable, and a quarantined one is killed by the kernel with no message.

## The config surface

`crust.config.ts` (or `crust.json`, same object):

```ts
import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.example", name: "Example", version: "0.1.0" },
	windows: [{ label: "main", url: "/", width: 1100, height: 760, title: "Example" }],
	dev: { url: "http://localhost:5173", beforeDevCommand: "bun run dev" },
	build: { assets: "dist/web", beforeBuildCommand: "bun x vite build" },
	plugins: ["crust:fs"],
} satisfies CrustConfig;
```

`dev.url` points the window at an existing dev server instead of the bridge; `beforeDevCommand` is started (not awaited) by `crust dev`. Without `dev.url`, the bridge serves `public/index.html` and injects its own token, which is the path the example takes.

`build.assets` names the directory `crust build` embeds — `public/` when absent, `dist/web` for the React template. A named directory must hold `index.html`; missing or empty stops the build naming that directory and saying the frontend has not been built, rather than packaging stale bytes. `build.beforeBuildCommand` runs first with stdio inherited, so the frontend's own output is visible, and a non-zero exit aborts the build naming the command and its exit code. A built app ignores `dev.url`: the generated entry drops that key, because a bundle has no dev server and must load the embedded document.

Every key is validated at startup; a bad config names the key and the shape it expected, e.g. `windows[0].width — expected a positive integer, got "wide"`.

## The app surface

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${name}`);
app.on("ready", () => console.log("windows open"));
await app.run();
```

Ten methods, three of which are not yours to call. `command`, `on`, `run`, `quit` and `invoke` are the surface every app writes; `use` mounts a plugin and `plugins` reads the mount list; `attach`, `deferBridge` and `configure` are what `startApp` calls, and the only reason they are public is that the runtime lives in a different module. [api.md](docs/api.md) documents each one. The page calls a command by name (`invoke("greet", { name })`); plugin commands use the three-argument form (`invoke("fs", "readTextFile", { path })`). An unknown name returns the bridge's structured error to the page — a rejected promise with `code` and `message` — never a process crash.

`app.run()` needs no manual wiring. Called through `crust dev` or a built app the platform, config and bridge are attached first; called bare (`bun src/main.ts`) it loads the config from the working directory and imports the macOS platform on demand, so no window code is linked into a process that never opens one.

## The numbers

Measured on this machine, Bun 1.4.4, macOS 27.0.1, arm64 (DESIGN.md §1 and §10, `research/`):

- **Size — 85 MiB.** The compiled binary for `examples/hello` measured **85.08 MiB** (89,209,442 bytes), the assembled `.app` **85.09 MiB** (89,219,072 bytes). A bare hello-world is 89,159,906 bytes (85.03 MiB); adding three thousand functions moved it 161 KiB. `--trim` is a no-op on stable 1.4.4.
- **Window visible — 299.5 ms** after process start, measured at `isVisible=1` on the spike's 1100×760 window. `WKWebView` alloc+init alone is 165 ms.
- **Page painted — 925.2 ms** after window creation, measured as the page's own report arriving at the server. Most of that is WebKit's web-process launch.
- **Cold start — median 5.76 ms** for the whole process on the compiled binary, **4.37 ms to a listening `Bun.serve`**, measured without a webview.
- **IPC — 0.119 ms median, 1.276 ms p99** over 200 invoke round trips; a reused connection is 0.045 ms.

The honest size claim is **"no bundled Chromium"**, never "as small as Tauri": Tauri's floor is 3–8 MB because it ships no JavaScript engine. That is the runtime, not your app, and it is the accepted cost of shipping neither Rust nor Chromium.

## Limits, stated plainly

- **macOS 13+ on arm64.** Intel Macs, Windows and Linux are not supported.
- **Ad-hoc signing only.** `codesign --sign -` works locally; `spctl` rejects it (exit 3) and it cannot be notarized, so Gatekeeper refuses the app on any other machine. Recipients run `xattr -dr com.apple.quarantine "Hello crust.app"` or right-click → Open. A Developer ID is `crust sign`'s job and needs a certificate this repository does not ship.
- **A built app embeds the whole asset directory.** By default that is `public/`; `build.assets` can name a frontend's output (`dist/web` for the React template, `out/` for Next). `.html`, `.js`, `.css`, `.json`, `.svg`, `.png`, `.woff2` and `.wasm` are served with their own content types, and a path with no extension falls back to `index.html` so a client-side route works. A frontend that a dev server builds outside the asset directory still needs its own build step.
- **`fs` and `dialog` work.** `fs` reads and writes files for real. `dialog` opens a real `NSOpenPanel` through a darwin adapter: a sheet attached to the window, which does not block the JavaScript thread, with `filters` applied through the deprecated `-setAllowedFileTypes:`. The `-runModal` path is the fallback for having no window to attach to, and it does block. A sheet and a completed pick are still **unverified** — the pick needs a human.
- **`tray` exists but nobody has seen it.** It builds a real menu-bar status item with a clickable menu, created, titled, shown, hidden and destroyed in a run. The run landed on a fullscreen space where the menu bar is hidden, so visual presence is unproven and a menu click needs a human.
- **`notification` is entered inside a bundle and refused, cause narrowed.** Inside a built `.app` the modern `UNUserNotificationCenter` path **is** entered and the callback fires with `granted = false`, reporting `{"delivered":false,"reason":"UNUserNotificationCenter: authorization was denied"}`. Two explanations were tested and ruled out: it is not an unanswered prompt (the callback fired well inside the 1.5 s wait), and it is not LaunchServices registration (`lsregister -f` then a re-run gave the identical answer, with the bundle listed under `codeInfoID: land.jyz.notif`). The cause is still unidentified; the remaining untested candidate is the app's signing identity. No fake success: `delivered` is true only when the OS reported delivery.
- **A blocking JavaScript call blocks drawing.** The Cocoa run loop is pumped from a timer (16 ms tick, 0.25 ms slice); long synchronous work belongs on a `Worker`.

## Layout

```
src/app.ts          the app surface: command, on, run, quit, invoke, + the Platform seam
src/runtime.ts      startApp: config + bridge + platform + the user's main.ts
src/single.ts       one-file mode: detect the shape, build the config in memory, bundle
src/config/         crust.config.ts / crust.json loading and validation
src/bridge/         loopback invoke + SSE bridge, and the page-side client
src/cli/            init, dev, build, sign, dmg, doctor
src/packaging/      binary compile, .app assembly, signing, dmg, icon
src/plugins/        definePlugin and the five built-in plugins: fs, dialog, window, tray, notification
src/platform/       the macOS implementation (shim.c compiled at launch by cc())
templates/default/  the app `crust init` copies
templates/react/    the React + Vite app `crust init --react` copies
templates/next/     the Next.js static-export app `crust init --next` copies
examples/hello/     the minimal app this README runs
```
