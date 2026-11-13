# crust

A Bun-native desktop app framework. Matches Tauri's shape — system webview, no
bundled Chromium, small cold start — without a Rust toolchain and without
shipping a compiled native artifact.

**No Rust. Just crust.**

macOS arm64 only for v1. The full design, with every measured number and its
command, is in [DESIGN.md](DESIGN.md).

---

## Status

The package shell is here: config loading, the `app` surface, the CLI, packaging,
plugins and the bridge. The macOS window layer (`src/platform/darwin`) is still
landing, so `crust dev` starts the backend and passes the frontend URL through
but does not open a window yet. `crust build` already produces a working `.app`
on arm64; the app inside it needs that window layer to show anything.

Do not read this as a finished product. It is the ten-minute path being built,
and the README records the real numbers rather than the hopeful ones.

## Ten minutes

### 1. Install

```sh
bun add crust
```

No build step, no native toolchain, no Xcode requirement. The package ships
TypeScript source and Bun runs it directly. (Not on npm yet — while the window
layer lands, link this directory instead: `bun link` from the crust checkout.)

### 2. Write `crust.config.ts`

```ts
import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.example", name: "Example", version: "0.1.0", icon: "assets/icon.png" },
	windows: [
		{ label: "main", url: "/", width: 1100, height: 760, minWidth: 720, title: "Example" },
	],
	dev: { url: "http://localhost:5173", beforeDevCommand: "bun run dev" },
	build: { beforeBuildCommand: "bun run build", minimumSystemVersion: "13.0" },
	plugins: ["crust:fs", "crust:dialog", "crust:notification"],
	security: { csp: "default-src 'self'" },
} satisfies CrustConfig;
```

`crust.json` works too, with the same object. Every key is validated at startup;
a bad config names the key and the shape it expected, e.g.
`windows[0].width — expected a positive integer, got "wide"`.

| key                          | required | shape                                            |
| ---------------------------- | -------- | ------------------------------------------------ |
| `app.id`                     | yes      | reverse-DNS bundle identifier                     |
| `app.name`                   | yes      | display name, also the `.app` filename            |
| `app.version`                | yes      | short version string                             |
| `app.icon`                   | no       | `.png` ≥ 1024px or `.icns`, relative to the project |
| `windows[].label`            | yes      | string, the key `app.window(label)` uses         |
| `windows[].url`              | no       | path the window loads, defaults to `/`           |
| `windows[].width`/`height`   | no       | positive integers                                |
| `windows[].minWidth`         | no       | positive integer                                 |
| `windows[].title`            | no       | window title                                     |
| `dev.url`                    | no       | dev server origin; required by `crust dev`       |
| `dev.beforeDevCommand`       | no       | starts the frontend dev server                   |
| `build.beforeBuildCommand`   | no       | builds the frontend before packaging              |
| `build.minimumSystemVersion` | no       | `LSMinimumSystemVersion`, defaults to `13.0`     |
| `plugins`                    | no       | array of plugin names                            |
| `security.csp`               | no       | explicit Content-Security-Policy for the page    |

### 3. Write `src/main.ts`

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${name}`);
app.on("ready", () => console.log("windows open"));
await app.run();
```

The page calls the handler with `window.crust.invoke<string>("greet", { name: "jyz" })`.

### 4. Run it

```sh
bunx crust dev
```

A backend edit restarts the app process. A frontend edit is the dev server's
HMR, so UI state survives. The window loads `dev.url` directly.

### 5. Build it

```sh
bunx crust build
open dist/Example.app
```

`crust build` compiles the backend with Bun, assembles the bundle, and ad-hoc
signs it. `crust dmg` then makes a drag-to-Applications image.

## Commands

```
crust dev      watch backend, restart the app process, follow the frontend URL
crust build    compile the binary, assemble X.app, ad-hoc sign
crust sign     Developer ID signing; fails clearly without CRUST_SIGNING_IDENTITY
crust dmg      drag-to-Applications disk image from the built bundle
crust doctor   report why the app did not open
```

Every command fails non-zero with a message naming the missing piece, never a
silent default.

## The numbers

Measured on this machine, Bun 1.4.4, macOS 27.0.1, arm64:

- **Size — 85 MiB.** A hello-world `bun build --compile` is 89,159,906 bytes
  (85.03 MiB); the assembled `.app` for this README's example was 89,169,920
  bytes (85.04 MiB). Three thousand extra functions moved the binary 161 KiB.
  `--trim` is a no-op on stable 1.4.4.
- **Cold start — median 5.76 ms** for the whole process on the compiled binary,
  **4.37 ms to a listening `Bun.serve`**, measured without a webview. WebView
  creation and web-process launch are the part still unmeasured.
- **IPC — 0.119 ms median, 1.276 ms p99** over 200 invoke round trips; a reused
  connection is 0.045 ms.

The honest size claim is **"no bundled Chromium"**. It is not "as small as
Tauri": Tauri's floor is roughly 3–8 MB because it ships no JavaScript engine,
so crust is about ten times bigger. That is the runtime, not your app, and it is
the accepted cost of shipping neither Rust nor Chromium.

## Limits, stated plainly

- **macOS arm64 only.** Intel Macs are not supported. Windows and Linux are
  designed for, not written.
- **No Developer ID yet**, so builds are ad-hoc signed. An ad-hoc signature
  cannot be notarized, so Gatekeeper refuses the app on any other machine.
  Recipients run `xattr -dr com.apple.quarantine Example.app`, or right-click
  the app and choose Open. This is a documented consequence, not a bug.
- **The window layer is not finished.** Everything else in this README runs;
  nothing renders yet.
- Only `fs` works among the v1 plugins. `dialog`, `tray` and `notification` fail
  honestly until the AppKit and `UNUserNotificationCenter` work lands.

## Layout

```
src/app.ts          the app surface: command, on, run, invoke — and the Platform seam
src/config/         crust.config.ts / crust.json loading and validation
src/cli/            dev, build, sign, dmg, doctor
src/packaging/      binary compile, .app assembly, signing, dmg, icon
src/plugins/        definePlugin and the four v1 plugins
src/bridge/         loopback invoke + SSE bridge
src/platform/       the macOS implementation (in progress)
```
