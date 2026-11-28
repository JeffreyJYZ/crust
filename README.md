# crust 🦀

crust builds desktop apps from Bun and the WebView already on the machine. No Rust, no bundled Chromium, no native build step.

[![release](https://img.shields.io/github/v/release/JeffreyJYZ/crust?style=for-the-badge)](https://github.com/JeffreyJYZ/crust/releases/latest)
[![ci](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/crust/ci.yml?branch=main&style=for-the-badge)](https://github.com/JeffreyJYZ/crust/actions/workflows/ci.yml)
[![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge)](https://crust.jyz.land/docs/reference/platforms)
[![license](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](package.json)

## ✨ Why crust

- 🦀 **A page calls native directly.** Windows, dialogs, tray, files and SQLite through `window.crust.invoke`. No IPC schema to design and no native module to write.
- 🪟 **The OS WebView.** WKWebView on macOS, WebKitGTK on Linux, WebView2 on Windows.
- ⚡ **One language.** TypeScript on both sides of a loopback bridge backed by a bearer token.
- 🔧 **Nothing to build before `run`.** A small C shim compiles at launch with the TinyCC inside Bun.

## 🚀 Quickstart

```sh
brew install JeffreyJYZ/tap/crust            # macOS; the formula tracks the newest tag
crust init my-app --react                   # also --next, --svelte, --vue, --solid
cd my-app && bun install && bun run dev
```

For a Bun global install, name no version here: every release publishes the exact `github:#v<version>` specifier on the [install page](https://crust.jyz.land/docs/start/install), so copy the current one there. That page also covers release binaries, a checkout and a standalone executable. `bun add crust` fetches an unrelated 2020 package, and a bare `github:JeffreyJYZ/crust` follows whatever a stale `bunx` cache resolved first. Plain `crust init my-app` is HTML with no bundler, and `crust dev app.tsx` runs a single file with no config.

## 🧩 Features

| Feature | What you get |
| --- | --- |
| **Most distinctive** | |
| 🪟 Windows | Create, focus, resize and close multiple real windows from the page. |
| 📑 Menus and tray | App menus, context menus and a menu-bar tray that fires into the page. |
| 🔒 Scoped filesystem | Read and write real files, narrowed by `fs.scope` prefixes in config. |
| 🧪 Testing | Drive and capture a real WebView page with no cursor and no screen grant. |
| 🌐 Embedded browser | A second WebView surface with bounds, navigation and capture on macOS. |
| **Solid but expected** | |
| 🗄️ SQLite | Open named databases, run SQL and read rows through `bun:sqlite`. |
| 📂 Dialogs | Native open and save panels with filters, non-blocking. |
| 🔗 Deep links | Register a `urlScheme` and receive URLs through the `deep-link` plugin. |
| ⬆️ Update and autostart | Signed updater plus OS autostart, both configured in `crust.config.ts`. |
| 📦 Sidecars | Bundle executables beside the binary and spawn them from the page. |
| 🛡️ Permissions | Capabilities and per-window grants, deny by default when configured. |
| **Nice to have** | |
| 📋 Clipboard | Read and write text or PNG images. |
| 🔔 Notifications | Deliver native notifications with a permission flow. |
| 📈 Performance | Mount the `perf` plugin, then record and diff frame numbers headlessly. |

Every namespace has a page in the [command reference](https://crust.jyz.land/docs/reference/api).

## 🧑‍💻 The shape of an app

The backend is Bun. A command is a function in `main.ts`:

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${name}`);
await app.run();
```

The page calls it by name and gets the return value back:

```js
await window.crust.ready;
const greeting = await window.crust.invoke("greet", { name: "Ada" });
```

`invoke(name, args)` routes to your command. `invoke(namespace, command, args)` calls a built-in plugin, for example `invoke("fs", "list", { path: "." })`. A built-in needs its own capability and a grant for that window label. The [first app guide](https://crust.jyz.land/docs/start/first-app) walks through the config files.

## 🖥️ Platform support

| Platform | WebView | Build output | Honest gaps |
| --- | --- | --- | --- |
| macOS 13+ | AppKit + WKWebView | `.app`, ad-hoc signed | An ad-hoc build is refused by Gatekeeper on other machines; `--sign` needs a Developer ID |
| Linux | GTK3 + WebKitGTK 4.1 | flat binary | Needs GTK3, WebKitGTK 4.1 and `libc6-dev` to build the shim |
| Windows | Win32 + WebView2 | flat `.exe` | Needs the WebView2 runtime; no DPI-awareness declaration |

All three ship x64 and arm64 release binaries. `browser.capture` is macOS only, WebView2 and WebKitGTK answer `not-implemented`. See [platforms](https://crust.jyz.land/docs/reference/platforms) and [limits](https://crust.jyz.land/docs/limits).

## 📚 Links

- 📖 [Docs](https://crust.jyz.land) · [Install](https://crust.jyz.land/docs/start/install) · [First app](https://crust.jyz.land/docs/start/first-app)
- 🤖 [SKILL.md for agents](https://crust.jyz.land/SKILL.md) · [Command reference](https://crust.jyz.land/docs/reference/api)
- 🧱 [Design notes](https://crust.jyz.land/docs/design) · [Evidence](https://crust.jyz.land/docs/evidence) · [Limits](https://crust.jyz.land/docs/limits)
- 🤝 [Contributing and traps](AGENTS.md) · [Changelog](CHANGELOG.md) · [MIT license](package.json)

## ⭐ Star crust

If crust saved you a Rust toolchain, star the repo: [JeffreyJYZ/crust](https://github.com/JeffreyJYZ/crust).
