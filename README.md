# crust

Desktop apps from Bun and the system WebView — macOS, Linux and Windows. No Rust, no bundled
Chromium, no native build step.

On macOS the window is AppKit and the page is `WKWebView`; Linux uses GTK3/WebKitGTK and Windows uses
Win32/WebView2. The backend is Bun answering `invoke` calls over a loopback bridge. The only C is a
small shim compiled at launch by the TinyCC that ships inside Bun, so there is nothing to build before
you run and no compiled artifact to match to your machine.

macOS 13+, Linux or Windows with WebView2 — x64 and arm64 on each. Homebrew is macOS-only.

## Quickstart

```sh
brew install JeffreyJYZ/tap/crust
crust init my-app --react
cd my-app && bun install && crust dev
```

Homebrew is macOS-only; on Linux or Windows download the matching release binary from the
[install page](https://crust.jyz.land/docs/start/install). Six assets are attached to each tag:
`crust-<version>-darwin-arm64`, `crust-<version>-darwin-x64`, `crust-<version>-linux-x64`,
`crust-<version>-linux-arm64`, `crust-<version>-windows-x64.exe`, `crust-<version>-windows-arm64.exe`.

Not on npm, and not going to be: `crust` on npm is an unrelated 2020 package, and `crust init` pins the dependency as `link:` to the CLI's own tree, so `bun add crust` fetches the wrong thing. Without Homebrew, work from a checkout —
`git clone https://github.com/JeffreyJYZ/crust && cd crust && bun install && bun run start init my-app` — or run `bun run build:standalone` for one executable that scaffolds with no checkout at all.

`crust dev` starts Vite on 5173 and points the window at it. On macOS `bun run build` then produces
`dist/my-app.app`, ad-hoc signed and double-clickable; on Linux and Windows it produces the flat
compiled binary, with no bundle and no signing.

No scaffold wanted? `crust init my-app` is plain HTML with no bundler, `crust init my-app --next` is
a Next.js static export, and `crust dev app.tsx` runs a single component file with no config at all.
`crust dev page.html` serves an `.html` file the same way, copying it as the document.

## The model

The backend is Bun. A command is a function:

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${name}`);

await app.run();
```

The page calls it by name, and the handler's return value comes back across the bridge:

```html
<script type="module">
	const greeting = await window.crust.invoke("greet", { name: "crust" });
	document.body.textContent = greeting;
</script>
```

That is the whole IPC surface: no schema to write, no serialisation to wire, and an unknown name
comes back as a rejected promise with a `code`, never a crashed process.

## Why it exists

- **No native build step.** No `cargo`, no Xcode project, no bottle per architecture. The shim
  compiles from source at launch, so a checkout runs as-is.
- **No Chromium.** The WebView already on the Mac does the rendering, which is why an app is ~86 MiB
  of embedded Bun runtime and your code rather than a browser engine of its own.
- **The boring surfaces work.** Files, dialogs, tray, notifications, windows, packaging, a dev server
  and a DMG — each one has a test behind it, not a promise.
- **One language end to end.** TypeScript on both sides of the bridge, and the same `crust` binary
  that scaffolds the app runs it and packages it.

## What ships

| surface                        | what you get                                                                                     | details                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `fs`                           | read, write, list, stat, rename and remove real files                                            | [files](https://crust.jyz.land/docs/guides/files)                 |
| `dialog`                       | native open and save sheets, non-blocking, with filters                                          | [dialogs](https://crust.jyz.land/docs/guides/dialogs)             |
| `window`                       | create, focus, close, set the title, and ask whether one is open                                 | [windows](https://crust.jyz.land/docs/guides/window)              |
| `tray`                         | a menu-bar item with rows that fire into your page                                               | [tray](https://crust.jyz.land/docs/guides/tray)                   |
| `notification`                 | delivered ad-hoc; refused from the temp dir, and a denied id stays denied until you re-enable it | [notifications](https://crust.jyz.land/docs/guides/notifications) |
| `crust build` / `dmg` / `sign` | macOS `.app` assembly, a disk image, and a Developer ID when you set `CRUST_SIGNING_IDENTITY`    | [packaging](https://crust.jyz.land/docs/guides/package)           |
| `crust dev`                    | a loopback bridge, or your own dev server with `beforeDevCommand`                                | [dev server](https://crust.jyz.land/docs/guides/dev)              |
| frontend                       | embedded asset directory, client-side routes served from `index.html`                            | [frontend](https://crust.jyz.land/docs/guides/frontend)           |

## What it will not do

- **No other architectures or mobile targets.** The six release binaries cover x64 and arm64 on
  macOS 13+, Linux and Windows (WebView2); there is no riscv64 build and no iOS or Android path.
- **Ad-hoc by default.** `crust build` signs with `codesign --sign -`, which opens on the machine that
  built it and is refused by Gatekeeper on any other, so a recipient needs `xattr -dr
com.apple.quarantine "my-app.app"` or right-click → Open. `crust sign` swaps in a Developer ID from
  `CRUST_SIGNING_IDENTITY`; no certificate ships with this repository.
- **A static bundle, not a server.** The bridge serves files from inside the app, so route handlers,
  middleware, SSR at request time and `next start` are out of scope for the Next.js mode.

## Docs and contributing

The documentation lives at **[crust.jyz.land](https://crust.jyz.land)** — one page per entry, source in [`site/`](site), served with
`cd site && bun install && bun run dev`. Every measured claim behind these pages is on the
[evidence](https://crust.jyz.land/docs/evidence) page, and the [limits](https://crust.jyz.land/docs/limits) page states the
consequences rather than the numbers.

Contributors and agents: [AGENTS.md](AGENTS.md) is the workflow and the traps. The design, with its
reasoning, is in [design](https://crust.jyz.land/docs/design).
