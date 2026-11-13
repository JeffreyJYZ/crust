# One file

`crust dev app.tsx` and `crust build app.tsx` run a single TSX file as an app: no `crust.config.ts`, no `main.ts`, one 900×700 window.

This is a development convenience. It is deliberately smaller than a project, and this page is the whole contract.

## What it does

- **Detects the shape.** The positional must end in `.tsx`, `.jsx`, `.ts` or `.js`, must exist, and must sit in a directory with no `crust.config.ts` or `crust.json`. A config beside the file means a real project: crust says so and refuses instead of guessing.
- **Builds the config in memory.** App id `crust.single.<name>`, app name and window title from the file's basename, version `0.0.0`, one window `900×700` at `/`. Nothing is written to disk as a config.
- **Bundles the page.** `Bun.build` with `target: "browser"`, ESM, no minify, never split. A dev bundle carries an inline sourcemap; a build has none.
- **Serves the page.** `index.html` loads `page.js` as a module. In dev the directory is `<file dir>/.crust/single` and the bridge serves it from disk. In a build the same two files are embedded in the binary.
- **Registers two commands.** There is no backend module, so the framework provides the round trip: `window.crust.invoke("info")` answers `{ app, file, single: true }` and logs a line on the backend, and `window.crust.invoke("echo", { … })` returns its argument unchanged. Every built-in plugin (`fs`, `dialog`, `window`, `tray`, `notification`) is still reachable in the three-argument form, e.g. `window.crust.invoke("window", "list", {})`.
- **Watches one file.** A change rebuilds into the same directory and writes a new reload marker; the page polls that marker and calls `location.reload()`. The runtime process is never restarted for a page edit, so the window stays open.
- **Keeps the last good page.** A rebuild failure prints the bundler's error and leaves the previous bundle on disk untouched. The window keeps showing it.

## The page convention

Exactly one rule, and it is textual:

- A file whose source contains `export default` is treated as a **React component**. crust mounts it into `#root` with `react-dom/client`, resolved from the file's own directory. `react` and `react-dom` must be installed there, or the build stops with a message saying so.
- Any other file is loaded for its **own side effects** and is expected to render the document itself. This is the path with no React at all.

```tsx
export default function App() {
	// runs in the page; return JSX
}
```

```ts
// no default export: this file owns the DOM
document.body.textContent = "hello";
```

The check is a regular expression over the source, not a parser. An `export default` inside a comment still counts.

## What it does not support

- **No HMR.** A save is a full page reload. UI state is lost, exactly as in a browser refresh.
- **Only the entry file is watched.** Imported local modules and CSS files are not; save the entry (or restart) to pick those up.
- **No npm resolution beyond the project.** Imports resolve from the file's own `node_modules` (plus nothing else). There is no import map, no CDN and no install step.
- **No custom backend.** With one file there is no place to register your own commands. `info` and `echo` are the app namespace; a real backend needs `crust.config.ts` and `main.ts`, i.e. a project.
- **No config surface.** The window size, title, app id and version are fixed by the rules above. No icon, no `dev.url`, no `beforeDevCommand`, no `beforeBuildCommand`, no `build.assets`, no plugins list, no CSP override.
- **No type checking.** The file is transpiled by Bun, not checked. Only JSX/TSX syntax and module resolution failures are reported.
- **macOS only**, like every crust app, and the built `.app` is ad-hoc signed: Gatekeeper refuses it on another machine until a Developer ID signature exists.

## Where files go

| Run | Written | Removed |
| --- | --- | --- |
| `crust dev app.tsx` | `<dir>/.crust/single/{index.html,page.js}`, a generated runner in `$TMPDIR/crust-single-*` | the runner directory on exit; the bundle is left for the next run |
| `crust build app.tsx` | `<dir>/dist/single/{index.html,page.js}`, `dist/crust-assets.ts`, `dist/crust-entry.ts`, `dist/<name>.app` | nothing — it is build output |

## When to graduate

Add `crust.config.ts` and `main.ts` the moment the app needs its own commands, a second window, an icon, a different size, or a watched tree. The single file was the shortest path to a window on a page; it is not a project layout.
