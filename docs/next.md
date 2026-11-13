# Next.js in a crust app

**crust ships one binary that carries the Bun runtime, your backend code and your frontend files, and serves them from its own loopback bridge. There is no server at runtime, so a Next app only fits in `output: "export"` mode.** Server Components that fetch at request time, route handlers, middleware, ISR and `next/image` optimisation all need a process to answer a request; crust has none, and it will not grow one. A Next app that needs any of them cannot ship this way — that is a scope limit, not a missing feature. Server Components still exist and are still worth using; they just run **once, at `next build`**, and their output becomes static HTML plus client chunks in the export.

The rest of this page is what the template's files do, what they deliberately leave out, and what was measured. The whole pipeline below was run on macOS on 2026-11-13 — install, init, build, launch, dev — with crust at `github:JeffreyJYZ/crust#206093c` plus the two template files this page's "What was run" section names as the fix. That snapshot predates the fixes; `v0.1.5` ships them in `templates/next/`. Every number and every failure sentence quoted there is copied from that run, not reasoned from the code.

## The shape of the app

Two halves, two processes, one bundle:

| half | runs where | what it is |
| --- | --- | --- |
| `app/`, `next.config.mjs`, `tsconfig.json` | `next build` only | a static export in `out/`, embedded into the binary at build time |
| `main.ts`, `crust.config.ts` | the binary, at runtime | the Bun backend, the window, and the bridge that serves the export |

The page talks to `main.ts` through `window.crust.invoke`, exactly like every other crust app. The bridge injects that client into the document it serves, so the export needs no knowledge of crust at all.

## Files

```
templates/next/
  package.json       crust, next, react, react-dom; typescript and two @types for `next build`
  next.config.mjs    output: "export", images.unoptimized
  tsconfig.json      app-only type program, so crust's own sources are never checked
  crust.config.ts    dev.url + beforeDevCommand, build.assets + beforeBuildCommand, one window
  app/layout.tsx     the root layout: <html lang="en">, metadata, the palette
  app/page.tsx       "use client": one component, one invoke after mount
  main.ts            one command, then app.run()
  .gitignore         node_modules, .next, out and dist
```

Eight files and that is the whole template. There is no `globals.css`: the palette is inline styles in `app/layout.tsx`, and `app/page.tsx` only sets what it needs on top.

`crust init <dir> --next` selects this template; `--react` selects React + Vite, and no flag gives the plain-HTML scaffold. Passing two template flags is refused before anything is written, naming both. The template is copied through the same token substitution the others use, so `{{package}}`, `{{name_text}}` and `{{crust_dep}}` are already resolved when you look at the files.

## Why those three devDependencies are there

`next build` runs `verifyTypeScriptSetup`, which does two things the template cannot opt out of:

1. **It refuses a `.tsx` tree with no `typescript` installed.** It does not fail — it tries to install `typescript`, `@types/react` and `@types/node` **with npm**, and npm since v9 refuses git dependencies (`EALLOWGIT`), so the install fails and the build stops. Set `typescript: { ignoreBuildErrors: true }` and it still installs, because the check is about the toolchain, not about the check. Integrating crust from a `github:` spec — the only way to install it before a registry publish — makes this the default outcome, so the deps ship in the template. Measured both ways.
2. **It type-checks every file reachable from what it includes.** `crust.config.ts` imports `type { CrustConfig } from "crust"`, and crust's `exports` maps `"."` to `./src/index.ts`. A default Next `tsconfig.json` includes `**/*.ts`, so the program reaches crust's own sources and reports *their* errors — `TS2307` for `@/bridge/errors`, `TS5097` for `.ts` import extensions, `TS2868` for the `Bun` global — and the build dies with `Failed to type check`. The template therefore ships `tsconfig.json` with `include: ["next-env.d.ts", "app/**/*.ts", "app/**/*.tsx", ".next/types/**/*.ts"]`: the page type-checks against `@types/react`, and `crust.config.ts`/`main.ts` are not in Next's program at all.

Next rewrites parts of that file on first build — it sets `jsx` to `react-jsx`, adds `allowJs`, and appends `.next/dev/types/**/*.ts` — and leaves the `include` list you gave it. That rewrite is why the file is committed in the template: what ships is what the build then owns.

## Dev and build

Development runs two things: `next dev` and the crust runtime.

```sh
bun install
bun run dev          # crust dev → `next dev -p 3000` → window at http://localhost:3000
```

Building is one command. `crust build` runs the Next export, then embeds it:

```sh
bun run build        # crust build → `next build` → out/ → embed out/ → dist/<App>.app
```

Read the config in that order:

```ts
dev: { url: "http://localhost:3000", beforeDevCommand: "bun --bun x next dev -p 3000" },
windows: [{ label: "main", url: "/", width: 1100, height: 760, title: "{{name_text}}" }],
build: {
	// `crust build` runs `next build` first, which writes the export to out/,
	// then embeds that directory instead of public/.
	assets: "out",
	beforeBuildCommand: "bun --bun x next build",
},
```

`beforeBuildCommand` → `bun --bun x next build` → `output: "export"` writes `out/` → `build.assets: "out"` names the tree `crust build` embeds → the bridge inside the binary serves it.

The ordering is measured, not promised. `resolveAssets` runs the command with inherited stdio and only then reads `build.assets`, so the frontend's own output is the user's to read and a failure cannot ship stale bytes. When `next build` exited 1 during this verification, `crust build` printed `build.beforeBuildCommand \`next build\` exited with 1 — the frontend build failed, so nothing was packaged`, exited 1 itself, and left `dist/` absent. `out/` and `.next/` are both gitignored, and `.next/` is never embedded: the second build after a dev session embedded 21 files from `out/`, and that is exactly the 21 files in `out/`.

Both hooks run through `sh -c` in the project directory. The template writes them as `bun --bun x next …`, so Bun resolves `next` through the project's `node_modules/.bin` and the version in `package.json` runs. A hook written as bare `next build` instead resolves from whatever `PATH` the crust process inherited: invoking `crust` by its absolute path (`./node_modules/.bin/crust dev`) leaves the global `PATH` alone, and a globally installed `next` then answers instead — on this machine `/opt/homebrew/bin/next` is v16.2.10 while the project has v16.4.6, so the window was served by a different Next than the one in `package.json`, with no warning anywhere.

**A hook written as bare `next dev` runs under whatever `node` is first on `PATH`**, because `node_modules/.bin/next` carries a `#!/usr/bin/env node` shebang; the template's `bun --bun x next dev` runs it under Bun instead. The Node case matters: on this machine `node` is a `v27.0.0-alpha` build, and `next dev` under it answers **500 on every request** with `TypeError: rawHeaders.hasOwnProperty is not a function`, from `next`'s own code. The same app, same Next version, under Node `v26.7.0` answers `200` in 150 ms. Next's dev server is the constraint, not crust — but a Next app inherits it, so pin a stable Node for a bare `next dev` hook if `crust dev` serves an error page.

`next dev` also writes `AGENTS.md` and `next-env.d.ts` into the project on first run (Next 16 generates its own agent rules file). `.gitignore` covers neither, so decide whether they are yours to commit; `agentRules: false` in `next.config.mjs` stops the first.

The Next side is two settings:

```js
const config = {
	output: "export",
	images: { unoptimized: true },
};
```

`output: "export"` is the whole mode. `images.unoptimized` is required because the optimiser is a server endpoint and there is no server. Nothing else is configured: no `distDir`, no `trailingSlash`, no middleware, no rewrites — each of those would only describe a server this app does not have.

The scripts are what a user types, and each one is crust:

```json
"dev": "crust dev",
"build": "crust build"
```

Run the binary inside the bundle directly rather than `open`: `open` routes through LaunchServices and Gatekeeper, and an ad-hoc signed bundle is refused there (see "Limits, stated plainly" in the README). `crust build`'s last line still suggests `open` — ignore it and run `dist/<App>.app/Contents/MacOS/crust-app`; that is the only launch path that reports an exit code.

## The layout is the theme

`app/layout.tsx` is the required root layout, and it carries the whole palette in one place — no stylesheet, and no script reading a media query:

```tsx
<html lang="en" style={{ colorScheme: "dark light" }}>
```

`colorScheme: "dark light"` says dark is the first preference and the system may flip it to light, and the body paints itself with `Canvas` / `CanvasText`, the two system colours that follow that choice. So the page is dark by default, readable on a light system, and needs neither a `.css` file nor a `prefers-color-scheme` listener. The rest of the body style — centred grid, monospace, padding — is a single inline object, next to `export const metadata` with the app's title.

## What the page does

`app/page.tsx` is a client component: one component, one effect, one call. The invoke happens after mount, never during render, because the export is a static document and the bridge is only reachable from a client:

```tsx
const crust = window.crust;
if (!crust) {
	setAnswer("no bridge");
	setStatus("window.crust is not installed in this page");
	return;
}
```

From there it is the ordinary two-argument app call, with its rejection turned into text instead of a thrown error in the console:

```tsx
crust
	.invoke("greet", { name: "crust" })
	.then((greeting) => {
		if (!live) return;
		setAnswer(String(greeting));
		setStatus(`answered over the bridge · ${crust.baseUrl ?? "unknown origin"}`);
	})
	.catch((error: unknown) => {
		if (!live) return;
		setAnswer("invoke failed");
		setStatus(error instanceof Error ? error.message : String(error));
	});
```

`window.crust` is not typed by the package, so the component declares the two members it uses, and paints the answer with `LinkText` and the status line with `GrayText` — system colours, so contrast holds in both schemes.

## Plugins: all of them, and none of them in Next

Every crust plugin works in this mode unchanged, because every crust plugin runs in the Bun backend. `main.ts` is a normal crust entry point:

```ts
app.command("greet", ({ name }) => {
	const answer = `hello ${typeof name === "string" && name.length > 0 ? name : "there"}`;
	console.log(`  greet     ${answer} (page call answered)`);
	return answer;
});
```

`fs`, `dialog`, `notification`, `tray` and `window` register exactly as they do in a scaffold with no frontend, selected by `config.plugins` the same way, and a plugin of your own mounts with `app.use` before `app.run()`. The page reaches them with the three-argument call, e.g. `invoke("fs", "readTextFile", { path })`; the two-argument form is app commands only. The current state of each plugin — including which ones answer `not-implemented` on this machine — is the table in [plugins.md](plugins.md#the-built-in-plugins-today).

Nothing about Next changes that. A plugin never runs inside a Server Component, a route handler or middleware, and none of those exist at runtime anyway.

## Not supported

Anything that needs a process to answer a request. Concretely, in this mode:

- **Request-time data in a Server Component** — `await fetch(...)` in a component that runs per request. It runs once at `next build`; whatever the data was then is what ships.
- **Route handlers** (`app/**/route.ts`, `pages/api/*`) — `output: "export"` refuses to build them, which is the right outcome: there is no server to receive the call.
- **Middleware** (`middleware.ts`) — needs a server in front of the files.
- **ISR** — `revalidate` and any background regeneration. The app is a fixed set of files inside a binary; nothing re-fetches them.
- **`next/image` optimisation** — the optimiser is a server endpoint, so the template sets `images: { unoptimized: true }`. Images ship as they are, at whatever size they were authored.
- **Server Actions** — they POST to the server.
- **`output: "standalone"` / `"server"`, and `next start`** — the whole point of this mode is that neither exists.
- **Request-time APIs** — `cookies()`, `headers()`, `draftMode()`. Use the crust bridge instead: that is what `window.crust.invoke` is for.
- **Dynamic routes whose parameters are not known at build time** — `generateStaticParams` works, but only for params that can be enumerated during `next build`.
- **Hot reload of the shipped app** — the export is embedded at build time; changing a page means rebuilding.

Two consequences worth knowing before you design around Next's dev server:

1. **`next dev` will happily serve a route handler that the export cannot ship.** `next build` is the truth, not the dev server — and with the pipeline above, `crust build` runs it for you.
2. **`window.crust` is absent in `next dev` today.** For Vite, `crust/vite` injects the page client into the document the dev server serves ([plugins.md](plugins.md#a-page-from-a-dev-server-crustvite)); there is no Next equivalent yet. The runtime does publish the pair — `.crust/dev.json`, plus `CRUST_BRIDGE_URL` / `CRUST_BRIDGE_TOKEN` on the child — but nothing injects it into a document `next dev` serves. So in development the page reports `window.crust is not installed in this page` and the window shows it — a loud failure, which is the intended behaviour of a page with no client ([plugins.md](plugins.md)). In a built app the page works, because the bridge injects its own client into the document it serves. Closing that dev gap is a Next-side version of `crust/vite`: it needs an injection point in `next dev`, not a change to anything in this template.

## Deep links

`next build` writes `app/about/page.tsx` to `out/about.html`, and the bridge serves a path only when the embedded tree has that exact file — a path with no extension falls back to `index.html`. Measured on the built app: `GET /about`, where no such file is embedded, answered `200` with byte-identical `index.html`; `GET /missing.js` answered `403`. So a reload of `/about` lands on the root document, a missing asset is refused rather than served the document, and in-app navigation stays client-side and never asks the bridge for a page.

## What was run

macOS, 2026-11-13, crust installed the way a stranger installs it: `BUN_INSTALL=<tmpdir>/bun bun add -g github:JeffreyJYZ/crust`, which resolved `crust@github:JeffreyJYZ/crust#206093c` and put the CLI at `<tmpdir>/bun/bin/crust` with nothing added to the machine's global bin. That snapshot's `templates/next/` was then replaced with the two fixed files from this checkout before `crust init` ran — a push was out of scope that afternoon, so that snapshot alone held the old template; `v0.1.5` (commit `e28e079`) now ships both fixes — and everything else stayed byte-identical to `206093c`. Then `crust init app --next`, `bun install` (29 packages), `bun run build`, and the bundle's own binary run directly with `/` as the working directory.

`crust init app --next` reported eight files: `app/layout.tsx`, `app/page.tsx`, `crust.config.ts`, `.gitignore`, `main.ts`, `next.config.mjs`, `package.json`, `tsconfig.json`. No `{{…}}` token survived substitution.

`bun run build` (the green run, exit 0):

```
crust build — …/app/crust.config.ts
  before    next build
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully in 756ms
  Running TypeScript ...
  Finished TypeScript in 518ms ...
✓ Generating static pages (3/3) in 138ms
  assets    21 files from out/
binary    85.83 MiB  90002018 bytes  …/dist/crust-app
  app       85.84 MiB  90013696 bytes …/dist/app2.app
  sign      ad-hoc (codesign --sign -)
```

`out/` held 21 files and 21 were embedded; `.next/` was on disk from the same build and none of it was embedded. A second build, after a `crust dev` session had rewritten `.next/`, produced the same 21 assets and the same 90,002,018-byte binary.

The binary inside `dist/app2.app` (89,478,912 bytes; the bundle 90,013,696) was launched as `dist/app2.app/Contents/MacOS/crust-app` with `cwd: "/"`:

```
bridge      http://127.0.0.1:46042
document    http 200  11090 bytes  next markup: true  injected bridge client: true
asset       /_next/static/chunks/1cuyxw6v18rxx.js  http 200  187255 bytes
route       /about  http 200  11090 bytes  same document: true
missing     /missing.js  http 403
greet       greet     hello crust (page call answered)
exit        0 (SIGTERM)
survivors   none
```

The document is 11,090 bytes over the wire against 5,884 bytes for `out/index.html` on disk — the injected client is the difference — and it carries `/_next/` script tags plus the bridge bootstrap, so the page runs from the embedded table with no project directory anywhere. `greet` is the backend's own log line, printed by the handler `main.ts` registered: the page's `invoke("greet", { name: "crust" })` reached the Bun process over the bridge and its return value came back. `SIGTERM` stopped it with exit 0 and nothing survived.

Dev was measured too, with `bun run dev` and Node 26.7.0 first on `PATH`: `next dev` answered `200` on `http://localhost:3000/` (9,397 bytes of Next dev markup), the runtime printed `bridge    http://127.0.0.1:46042  (page from http://localhost:3000)`, and the served document carried **no** bridge client — the dev gap above, confirmed rather than assumed. `SIGTERM` to the `crust dev` process left exit 0, port 3000 free, and no surviving process.

Two things that were broken at `206093c` and are fixed by this template:

- **`bun run build` failed** at `next build`'s TypeScript setup, which tried `npm install --save-exact --save-dev typescript @types/react @types/node` and died on `npm error code EALLOWGIT … Refusing to fetch "crust@github:JeffreyJYZ/crust"`. Fixed by shipping those three devDependencies (`templates/next/package.json`).
- **With `typescript` installed, the type check failed on crust's own sources** (`TS2307`/`TS5097`/`TS2868`, then `Failed to type check`). Fixed by shipping an app-only `tsconfig.json` (`templates/next/tsconfig.json`).

One defect this run found is now fixed: `src/cli/dev.ts` watches the project for backend changes and `isIgnoredWatchPath` (`src/cli/ignore.ts`) skips `public/`, `dist/`, `node_modules/`, `.next/`, `out/` and `.crust/`, so `next dev` writing its own build output no longer restarts the Bun backend. At `206093c` it did: `restart   backend changed` appeared twice during a single page load, and the window reloaded while Next compiled.
