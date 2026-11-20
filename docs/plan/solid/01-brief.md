# Ship `crust init --solid`

Solid 2.0 shipped stable 16–17 November 2026: async inside the reactive graph, server functions in
core, **SolidStart retired**. crust has no Solid template; every other frontend it ships is a Vite
project, so this is a copy of `templates/react` with the plugin swapped.

## What "support" means here

Not SolidStart — retired in 2.0, and `dev.url` wants one origin serving one SPA, which a plain Vite
Solid app is. So the template is: Vite + `vite-plugin-solid` + Solid 2, wired the way the react template
already is.

Read `templates/react/` first and mirror it exactly:

```
crust.config.ts   dev.url http://localhost:5173 + beforeDevCommand
                  build.assets dist/web + beforeBuildCommand
vite.config.ts    strictPort true, build.outDir dist/web
src/main.tsx      mounts the app
src/App.tsx       the same demo the other templates show (invoke("greet"), a status line)
index.html
package.json      solid-js ^2, vite-plugin-solid, vite
```

The demo must use the same `window.crust` surface the other templates do — `await window.crust.ready`
then `window.crust.invoke("greet", { name })` — because that is what proves the bridge works from a
Solid page, and it is the only interesting claim in this template.

## Constraints

- `vite-plugin-solid` must be a version that actually supports `solid-js@2`. Check the registry, do not
  assume; if no released plugin supports 2.0, stop and report that with the versions you found — shipping
  a template that cannot build is worse than no template.
- `crust init` counts are asserted in `src/cli/init.test.ts` and the standalone gate pins expected file
  counts in `scripts/build-standalone.ts`. Both move in the same change.
- Add the flag everywhere the other four appear: `src/cli/argv.ts`, `commands.ts`, `help.ts`, first-run
  text, and the init writer.
- Never `bun fmt` without a path list; 200-line cap; `rg`/`fd`, `sd`, never `grep`/`find`/`sed`.

## The proof that matters

A template that type-checks is not a template that runs. Prove, in order, pasted output:

1. `crust init /tmp/solid-probe --solid` writes the expected files (list them).
2. `bun install` inside it succeeds.
3. `bun x vite build` produces `dist/web/index.html`.
4. `crust build --dir /tmp/solid-probe` produces the app, and launching the binary prints the greet
   round trip (`greet … (page call answered)`), under `guardFocus()`/`restoreFocus()`.

If step 3 or 4 cannot be reached, say exactly where it stopped.
