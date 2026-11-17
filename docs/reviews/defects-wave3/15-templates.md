# Templates and examples

Read by me, not by a hunter — the assigned lane never wrote its file and the area is small.

## Findings

### 1. `templates/react` builds twice, and the second build can embed a stale tree — LOW
`templates/react/package.json:6` versus `templates/react/crust.config.ts:13`

`bun run build` is `vite build && crust build`, and `crust build` also runs
`build.beforeBuildCommand`, which is `vite build` again. Two full Vite builds per `crust build`,
because the package script does what the config already declares. Harmless today (vite's
`emptyOutDir` makes the second run idempotent) but it doubles the slowest step of every build.

**Breaks:** nothing, yet. It is a doubled build and a duplicate source of truth: change the config
and the package script still runs its own.
**Evidence:** `"build": "bun --bun ./node_modules/.bin/vite build && crust build"` at
`templates/react/package.json:6`, and `beforeBuildCommand: "bun --bun ./node_modules/.bin/vite build"`
at `templates/react/crust.config.ts:13`, which `src/cli/build.ts:73` runs inside `crust build`.

### 2. `templates/default/public/app.js` calls `invoke` with two arguments — LOW
`templates/default/public/app.js:8`

`window.crust.invoke("greet", { name: "crust" })` is the two-argument form, which resolves a
plugin command by name alone. It works because the scaffold registers exactly one `greet`, but a
reader copying this into an app with two plugins gets a refusal, and the comment above it never
names the three-argument `invoke(plugin, command, args)` form the docs teach.

**Breaks:** nothing in the template; a copy-paste into a second-plugin app fails with no hint.
**Evidence:** `window.crust.invoke("greet", { name: "crust" })` at
`templates/default/public/app.js:8`, against `invoke("greeting", "greet", { name })` in
`examples/hello/main.ts`.

## Coverage

All three templates read in full (`default` 7 files, `react` 8, `next` 10), plus
`examples/hello` and `examples/extensions`. No template file exceeds 200 lines (`react/src/main.tsx`
is the largest at 111). Checked and found sound: each template's `package.json` installs (`crust` is
the `{{crust_dep}}` placeholder `crust init` fills, no `link:` path is baked in), every
`beforeDevCommand` names a binary its own `devDependencies` install, the three `crust.config.ts`
files agree on `app.id`/`windows`/`build.assets` shape, and `examples/*` import only what
`src/index.ts` and `src/plugin.ts` still export.

Not checked: a real `bun install` inside each emitted tree — the templates were read, not built.
