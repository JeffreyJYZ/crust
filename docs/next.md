# Next.js in a crust app

**crust ships one binary that carries the Bun runtime, your backend code and your frontend files, and serves them from its own loopback bridge. There is no server at runtime, so a Next app only fits in `output: "export"` mode.** Server Components that fetch at request time, route handlers, middleware, ISR and `next/image` optimisation all need a process to answer a request; crust has none, and it will not grow one. A Next app that needs any of them cannot ship this way — that is a scope limit, not a missing feature. Server Components still exist and are still worth using; they just run **once, at `next build`**, and their output becomes static HTML plus client chunks in the export.

The rest of this page is what the six files in `templates/next/` do, what they deliberately leave out, and what has and has not been run.

**Nothing here has been run, and the build is unverified.** The pipeline below depends on `crust build` running `build.beforeBuildCommand` *before* it reads the asset directory, which is being added to `src/cli/build.ts` by another lane; until that lands, `crust build` would embed whatever stale `out/` happens to be on disk instead of a fresh export. Nothing in this template has been installed, built or opened. Verification — `bun install`, `bun run build`, run the binary inside the bundle — is the next step, and it needs that support present. Everything else was read from [api.md](api.md), [plugins.md](plugins.md), the config schema and the template as written.

## The shape of the app

Two halves, two processes, one bundle:

| half | runs where | what it is |
| --- | --- | --- |
| `app/`, `next.config.mjs` | `next build` only | a static export in `out/`, embedded into the binary at build time |
| `main.ts`, `crust.config.ts` | the binary, at runtime | the Bun backend, the window, and the bridge that serves the export |

The page talks to `main.ts` through `window.crust.invoke`, exactly like every other crust app. The bridge injects that client into the document it serves, so the export needs no knowledge of crust at all.

## Files

```
templates/next/
  package.json       crust, next, react, react-dom; dev and build call crust
  next.config.mjs    output: "export", images.unoptimized
  crust.config.ts    dev.url + beforeDevCommand, build.assets + beforeBuildCommand, one window
  app/layout.tsx     the root layout: <html lang="en">, metadata, the palette
  app/page.tsx       "use client": one component, one invoke after mount
  main.ts            one command, then app.run()
```

Six files and that is the whole template. There is no `globals.css`: the palette is inline styles in `app/layout.tsx`, and `app/page.tsx` only sets what it needs on top. There is no `tsconfig.json` either — Next writes one on first run.

`crust init <dir> --next` selects this template; `--react` selects React + Vite, and no flag gives the plain-HTML scaffold. Passing two template flags is refused before anything is written, naming both. The template is copied through the same token substitution the others use, so `{{package}}`, `{{name_text}}` and `{{crust_dep}}` are already resolved when you look at the files.

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
dev: { url: "http://localhost:3000", beforeDevCommand: "next dev -p 3000" },
windows: [{ label: "main", url: "/", width: 1100, height: 760, title: "{{name_text}}" }],
build: {
	// `crust build` runs `next build` first, which writes the export to out/,
	// then embeds that directory instead of public/.
	assets: "out",
	beforeBuildCommand: "next build",
},
```

`beforeBuildCommand` → `next build` → `output: "export"` writes `out/` → `build.assets: "out"` names the tree `crust build` embeds → the bridge inside the binary serves it. **A non-zero exit from `next build` has to abort the crust build**, or a broken page ships as the previous successful export. `beforeBuildCommand` is documented to abort on a non-zero exit ([api.md](api.md#keys-and-defaults)); doing that *before* assets are read is the part still landing.

Both hooks run through `sh -c` in the project directory. `bun install` puts `next` in `node_modules/.bin`; if that is not on `PATH` in this shell, write `bunx next build` and `bunx next dev -p 3000` in `crust.config.ts` instead — same commands, one word longer.

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

Run the binary inside the bundle directly rather than `open`: `open` routes through LaunchServices and Gatekeeper, and an ad-hoc signed bundle is refused there (see "Limits, stated plainly" in the README).

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
2. **`window.crust` is absent in `next dev` today.** For Vite, `crust/vite` injects the page client into the document the dev server serves ([plugins.md](plugins.md#a-page-from-a-dev-server-crustvite)); there is no Next equivalent yet, and crust's runtime does not publish the bridge URL and token to a dev child either. So in development the page reports `window.crust is not installed in this page` and the window shows it — a loud failure, which is the intended behaviour of a page with no client ([plugins.md](plugins.md)). In a built app the page works, because the bridge injects its own client into the document it serves. Closing that dev gap is a Next-side version of `crust/vite`: it needs an injection point in `next dev`, not a change to anything in this template.

## Deep links

`next build` writes `app/about/page.tsx` to `out/about.html`, and the bridge serves a path only when the embedded tree has that exact file — a path with no extension falls back to `index.html`. So a reload of `/about` lands on the root document, while in-app navigation stays client-side and never asks the bridge for a page. Neither behaviour has been exercised here.
