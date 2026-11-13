# Adding crust to an existing React app

An upgrade guide for someone who already has a working Vite + React app: the exact
diffs, the commands, and what does not work. Nothing here asks you to rewrite the
app. No React file changes, no router change, and your existing `build` script
stays exactly as it was.

Verified 2026-11-13 by hand-building the app in [What the app already was](#what-the-app-already-was)
at `/tmp/existing-react` (Vite 8.3.8, React 19.3.1, `@vitejs/plugin-react` 5.2.0,
TypeScript 5.9.3, Bun 1.4.4, macOS 27.0.1 arm64), running `crust dev` once and
calling `invoke` from that page, then running `crust build` once. The scratch
directory is gone; every block below is the output of that run.

## What it costs

Four files, two of them new: **32 added lines and 2 lines edited in place.**

| file | change | lines |
| --- | --- | --- |
| `package.json` | the dependency, plus one script for `crust dev` and one for `crust build` | +3, 1 edited |
| `vite.config.ts` | `crust()` beside `react()`, a pinned `server.port`, a `build.outDir` | +5, 1 edited |
| `crust.config.ts` | **new** — `dev.url`, one window, the build hook | 14 |
| `desktop/main.ts` | **new** — the backend entry: one command and `app.run()` | 10 |

`bun install` after the dependency line also writes `bun.lock`. Nothing else in
the project moves.

## What the app already was

Before crust was involved, the project was a normal hand-written Vite app, built
once and working:

```text
$ bun install
+ @vitejs/plugin-react@5.2.0
+ react@19.3.1  + react-dom@19.3.1  + typescript@5.9.3  + vite@8.3.8

$ bun run build
$ tsc --noEmit && vite build
✓ 15 modules transformed.
dist/index.html                  0.32 kB │ gzip:  0.23 kB
dist/assets/index-O_7_GOWh.js  219.83 kB │ gzip: 68.76 kB
✓ built in 58ms
```

Its `src/App.tsx` is a counter, its `src/main.tsx` mounts it into `#root`, its
`index.html` loads `/src/main.tsx`, and its `package.json` scripts are
`dev: vite`, `build: tsc --noEmit && vite build`, `preview: vite preview`. None
of that changes below.

## The diffs, as run

### `package.json`

```diff
@@ -6,7 +6,9 @@
   "scripts": {
     "dev": "vite",
     "build": "tsc --noEmit && vite build",
-    "preview": "vite preview"
+    "preview": "vite preview",
+    "desktop": "crust dev --entry desktop/main.ts",
+    "desktop:build": "crust build --entry desktop/main.ts"
   },
@@ -16,6 +18,7 @@
     "@types/react": "^19.2.0",
     "@types/react-dom": "^19.2.0",
     "@vitejs/plugin-react": "^5.0.0",
+    "crust": "link:/Users/jyz/dev/crust",
     "typescript": "^5.9.0",
     "vite": "^8.3.8"
```

The `link:` form is this checkout. An installed project pins the package the same
way `crust init` does — `"crust": "github:JeffreyJYZ/crust"`, or the registry
version once there is one. The two scripts are new names; `dev`, `build` and
`preview` are untouched, so `bun run dev` and `bun run build` keep doing what they
did.

### `vite.config.ts`

```diff
@@ -1,6 +1,11 @@
 import react from "@vitejs/plugin-react";
 import { defineConfig } from "vite";
+import { crust } from "crust/vite";
 
 export default defineConfig({
-  plugins: [react()],
+  // The bridge allows exactly the origin `dev.url` names, so pin the port.
+  server: { port: 5173, strictPort: true },
+  // crust build writes its own output to dist/, so Vite's goes below it.
+  build: { outDir: "dist/web" },
+  plugins: [react(), crust()],
 });
```

Three lines earn their place:

- **`crust()`** injects `window.__CRUST__` and the page client into the document
  Vite serves. It is serve-only, so your production HTML never carries a token.
- **`server.port` + `strictPort`** — the bridge allows exactly the origin
  `dev.url` names (the runtime passes `devOrigin: originOf(dev.url)`), so the
  port must not drift. Vite otherwise moves to the next free port and every
  `invoke` is refused as a foreign origin.
- **`build.outDir: "dist/web"`** — `crust build` writes its own output to `dist/`
  and refuses a `build.assets` that resolves to `dist/` itself, because a second
  build would embed its own binary. Your `vite build` keeps working unchanged;
  its files just land one level lower.

### `crust.config.ts` (new)

```ts
import type { CrustConfig } from "crust";

export default {
  app: { id: "land.jyz.existing-react", name: "Existing React", version: "0.0.0" },
  windows: [{ label: "main", width: 900, height: 640, title: "Existing React" }],
  dev: {
    url: "http://localhost:5173",
    beforeDevCommand: "bun run dev",
  },
  build: {
    beforeBuildCommand: "bun run build",
    assets: "dist/web",
  },
} satisfies CrustConfig;
```

`dev.beforeDevCommand` is your existing `dev` script, started (not awaited) by
`crust dev`. `build.beforeBuildCommand` is your existing `build` script, and
`build.assets` is where it puts the static files. There is no second build
pipeline: the one you already had runs, and crust embeds its output.

### `desktop/main.ts` (new)

```ts
import { app } from "crust";

app.command("greet", ({ name }) => {
  const who = typeof name === "string" && name.length > 0 ? name : "there";
  const answer = `hello ${who}, from crust`;
  console.log(`  greet     ${answer} (page call answered)`);
  return answer;
});

await app.run();
```

The rule is one line of prose: **a command is a name plus a function, and
`await app.run()` is the last statement.** Handlers must not block — there is one
JavaScript thread, and a synchronous handler stops the bridge and the Cocoa pump
with it.

## Why the backend entry is `desktop/`, not `src/`

Both reasons were measured on this app, not assumed.

**1. `tsc --noEmit` would type-check crust's own source.** `crust` ships
TypeScript (`exports` points at `src/index.ts`), so an entry that imports it is a
program file, and every `.ts` it imports joins your type check. With the same
content at `src/main.ts` and the app's `include: ["src"]`:

```text
$ bun x tsc --noEmit
20 errors: 8 × TS5097 (allowImportingTsExtensions), 6 × TS2307 (`@/…` alias),
3 × TS2867 (`Bun`), 2 × TS2580 (`process`), 1 × TS2339 (`unref`)
```

Those are crust's internals against your tsconfig, not mistakes in your app. With
the entry at `desktop/main.ts` the unchanged `tsc --noEmit && vite build` passes
again, because `desktop/` is outside `include`. If your tsconfig has no `include`
(it then defaults to every `.ts` in the project), add `desktop` to `exclude`.

**2. The backend watcher covers the entry's directory.** `crust dev` watches
`dirname(entry)` recursively and restarts the runtime on any change there
(`public/`, `dist/`, `node_modules/`, `.next/`, `out/` and `.crust/` excepted). An entry under `src/` means
every UI edit restarts the backend — and a restart rotates the bridge token, so a
page loaded before it starts answering `CrustInvokeError: missing or bad bearer
token` until it reloads. `desktop/` keeps HMR entirely on Vite's side, which is
the point of `dev.url`.

## Dev: one command

```sh
bun run desktop
```

Measured output, unchanged React page on the other end:

```text
crust dev — /private/tmp/existing-react/crust.config.ts
  frontend  http://localhost:5173 (HMR stays with the dev server)
  before    bun run dev

$ vite
  bridge    http://127.0.0.1:48056  (page from http://localhost:5173)

  VITE v8.3.8  ready in 59 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  greet     hello react, from crust (page call answered)
```

One window opens on the Vite page. Editing a `.tsx` file reloads the page through
Vite and touches nothing on the backend.

## The page call, and the proof nothing was rewritten

The served document carried exactly the two injected tags the plugin promises:

```html
<script>window.__CRUST__ = {"url":"http://127.0.0.1:48056","token":"ff5a0b46-…"};</script>
<script>…installCrust…</script>
```

With `App.tsx`, `main.tsx` and `index.html` untouched, this call in the page —
run in the page's console, the same call app code makes — reached the backend:

```js
await window.crust.invoke("greet", { name: "react" })
```

```json
{
  "baseUrl": "http://127.0.0.1:48056",
  "answer": "hello react, from crust",
  "title": "Existing React app",
  "heading": "Existing React app",
  "buttonText": "count is 0"
}
```

and the backend printed `greet hello react, from crust (page call answered)`.
`invoke` is two arguments here, the app form; plugin commands use the
three-argument form, `invoke("fs", "readTextFile", { path })`.

`window.crust` has no ambient TypeScript declaration. If your app calls it, write
one small `declare global` interface with just the members you use, rather than
casting at every call site.

## Build: one command

```sh
bun run desktop:build
```

```text
crust build — /private/tmp/existing-react/crust.config.ts
  before    bun run build
$ tsc --noEmit && vite build
✓ 15 modules transformed.
dist/web/index.html                  0.32 kB │ gzip:  0.23 kB
dist/web/assets/index-O_7_GOWh.js  219.83 kB │ gzip: 68.76 kB
✓ built in 49ms
  assets    2 files from dist/web/
binary    85.45 MiB  89605730 bytes  …/dist/crust-app
assembled 85.46 MiB  89616384 bytes  …/dist/Existing React.app
  sign      ad-hoc (codesign --sign -)
done — open it locally with: open …/dist/Existing React.app
```

Your `build` script ran as-is through `beforeBuildCommand`; the binary embeds
`dist/web/`. A path with no extension is served from `index.html`, so a
client-side route works without a router change. `build.assets` may not resolve
to `dist/` itself — the command refuses that, because a second build would then
walk its own binary.

## What you must not do

- **Do not import crust in your React code.** There is no import in `App.tsx`,
  `main.tsx` or any component. `window.crust` arrives through the injected
  client; a page import would be a second client and a bundle dependency on a
  Bun-only package.
- **Do not change your router.** Nothing here touches `react-router` or any other
  router. The built bridge falls back to `index.html` for extensionless paths.
- **Do not change your `build` or `dev` scripts.** They are called by
  `beforeDevCommand` and `beforeBuildCommand`. Adding a second `vite build` or
  pointing `build` at a different output directory is how the two drift apart.
- **Do not move `server.port` off the `dev.url` origin**, and do not use
  `127.0.0.1` in one place and `localhost` in the other — they are different
  origins to the bridge.
- **Do not put the backend entry back under `src/`** without handling both
  problems in [Why the backend entry is `desktop/`](#why-the-backend-entry-is-desktop-not-src).

## What breaks

- **SSR does not work.** crust serves static files: `crust build` embeds the
  directory Vite produced and the window loads it from disk. There is no server
  rendering step, no server bundle, and no place for `getServerSideProps`-style
  code to run.
- **Anything that is not Vite is untested.** CRA (`react-scripts`), Webpack, Rspack and Parcel were not run against crust, so this page does not claim them: the only dev-server integration that exists is `crust/vite`. Next.js is supported on a different path — a static export embedded at build time, with no dev-server client — and [next.md](next.md) is that contract and its measurement.
- **A backend restart invalidates the loaded page's token.** The bridge issues a
  new token per launch, and the page's copy came from the document it was served.
  Until the page reloads, `invoke` rejects with `missing or bad bearer token`.
  Fix by keeping the backend entry out of the frontend's directory, as above.
- **macOS arm64 only.** No Windows, no Linux, no Intel. `crust build` ad-hoc
  signs; another machine needs `xattr -dr com.apple.quarantine` or right-click →
  Open.
- **A blocking handler blocks drawing.** Keep handlers async; long synchronous
  work belongs on a `Worker`.
- **A handler that throws is a rejected promise, not a crash** — the page gets
  `code` and `message`, so there is nothing to catch at the process level.
