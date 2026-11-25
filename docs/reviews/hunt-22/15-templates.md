# Hunt 22 — templates and scaffold

Read-only hunt. Scope: `templates/{default,react,next,svelte,vue,solid}/**`, `src/cli/init.ts`,
`src/cli/assets.ts`, and the release/package gates that read those files
(`scripts/release/template-security.test.ts`, `scripts/release/template-frameworks.test.ts`,
`scripts/verify-package/phases/travel.ts`, `scripts/build-standalone.ts`, `src/cli/init.test.ts`).
Discovery used `rg`/`fd`; all probes were `bun -e` or `curl` reads. No source was changed, no gate
was run to completion, no GUI or cursor action occurred.

**Count: 3 new findings** (0 high, 1 medium gate gap, 2 low) plus 2 still-live hunt-20 findings
re-verified and one hunt-20 open question settled. The shipped scaffold files themselves are in
good shape: every template grants the exact command its page calls, every backend registers
`window-all-closed`, every pinned version exists on the registry, and every dev URL/build output
pair agrees. The defects are concentrated in the gates that are supposed to keep it that way.

---

## F1 (medium, new) — Solid is absent from the scaffold security gate, and the gate's parser cannot read Solid's invoke form

- `scripts/release/template-security.test.ts:24-30` — `TEMPLATES` lists `default`, `react`,
  `next`, `svelte`, `vue`. Solid is the only scaffold not listed. The second test's name at
  `:90` still says `all five scaffolds`.
- `scripts/release/template-security.test.ts:50-58` — `actionsIn` matches only
  `/\.invoke\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/g`. It requires `(` immediately after `invoke`.
  Solid's page uses a typed generic: `templates/solid/src/App.tsx:87` calls
  `window.crust.invoke<string>("greet", { name: "solid" })`. The `<string>` breaks the match.
- Reached: the gate's own contract at `:4-8` is "a template's config is only correct when its
  grant covers the exact actions its own page calls". Solid is never evaluated. Simply adding
  Solid to the list would still pass vacuously: `actionsIn` returns `[]`, and `:78-79` returns
  early when there are no calls. So the exact class of bug commit `ce1f65b` fixed in the other
  five (broad `app:invoke` grant, wrong comment) would ship unnoticed in Solid.
- Measured: ran the test's own regex over both page sources. `templates/solid/src/App.tsx`
  produced `solid matches: []`; `templates/react/src/main.tsx` produced
  `react matches: [ '.invoke("greet"' ]`. Read of `:24-30` and `:90` confirms no Solid row.
- Honest scope: this is a gate gap, not a live runtime defect. `templates/solid/crust.config.ts:13-16`
  currently grants `app:greet` and `grants: { main: ["app"] }`, which is correct. Nothing proves
  Solid's page is refused today. The defect is that nothing would catch it if it changed.
- Smallest fix: add `{ name: "solid", flag: "--solid", page: ["src/App.tsx", "main.ts"] }` to
  `TEMPLATES`, widen the regex to `/\.invoke(?:<[^>]*>)?\s*\(.../`, and rename the row to six.

---

## F2 (low, new) — the `--next` scaffold's token substitution and file count are untested

- `src/cli/init.test.ts:30` — `COUNTS = { react: 6, svelte: 7, vue: 7, solid: 9, "": 6 }`. No
  `next` key. The loop at `:42-56` iterates `["react", "svelte", "vue", "solid"]`, so the
  assertion `expect(config).not.toContain("{{")` and the `app.crust.my-app` / `name: "My App"`
  checks never run for Next.
- `src/cli/init.test.ts:108-116` asserts the standalone gate contains `["<flag>", <count>]`
  for every `COUNTS` entry. With no `next` entry, that cross-check never sees the real gate
  literal `["--next", 8]` at `scripts/build-standalone.ts:22`.
- Reached: Next is the one template whose human name is substituted into three separate page
  files — `templates/next/app/layout.tsx:5`, `app/page.tsx:65`, `app/about/page.tsx:24` — plus
  `crust.config.ts:4,11`. A future edit that introduces a token only in Next, or drops one from
  the token map, leaves unit tests green. The standalone gate counts files but never reads the
  written bytes.
- Measured: scaffolded `--next` into a temp dir with a space in the name and read the result:
  `name: "My App"`, `id: "app.crust.my-app"`, and `title: "My App"` all substituted correctly.
  The scaffold works; only its test coverage is missing.
- Smallest fix: add `next: 8` to `COUNTS` and `"next"` to the loop at `:42`.

---

## F3 (low, new) — Next about-route comment states a file layout the config does not produce

- `templates/next/app/about/page.tsx:7-9` says `output: "export"` emits `/about/index.html`.
- `templates/next/next.config.mjs:7-10` sets `output: "export"` and `images.unoptimized` but no
  `trailingSlash`, so Next's default `false` applies. Next's static-export docs state that
  `trailingSlash: true` is what changes links from `/me` to `/me/` and emits `/me.html` as
  `/me/index.html`; with the default, the file is `about.html`, not `about/index.html`.
  Source: <https://nextjs.org/docs/app/guides/static-exports> (the `next.config.js` sample
  comments: "Change links `/me` -> `/me/` and emit `/me.html` -> `/me/index.html`").
- Reached: a reader copies the comment's model of the export tree into their own routing or
  asset assumptions. This settles the "unsettled, not a finding" note in
  `docs/reviews/hunt-20/23-templates.md:45`; the comment is wrong as written.
- Honest scope: no broken navigation proven. The bridge's extensionless SPA fallback
  (`src/bridge/server/handler.ts:138-142`) can still serve a document for `/about`, and Next's
  client router may render the route from the pathname. The defect is the factual claim in
  scaffolded code, not a demonstrated dead link.
- Smallest fix: change the comment to `about.html` (or add `trailingSlash: true` if the
  directory form is actually wanted).

---

## Still live — re-verified from hunt-20, not new

- **Three Vite scaffolds use `window.crust` with no ambient type declaration.**
  `docs/reviews/hunt-20/23-templates.md:17-22` named `templates/react/src/main.tsx:73`,
  `svelte/src/App.svelte:19-20`, `vue/src/App.vue:20-21`. All three call sites are unchanged and
  none of those three directories ships a `crust.d.ts` or a `tsconfig.json`. Solid, added later,
  does ship `templates/solid/src/crust.d.ts` and a strict `tsconfig.json`, so it is not part of
  this finding. Vite's esbuild strips the types without checking, so the build passes while a
  TS-aware editor flags `window.crust`.
- **Vanilla scaffold's gitignore still omits `.crust/`.**
  `docs/reviews/hunt-20/23-templates.md:31-36`; `templates/default/gitignore:1-4` has only
  `node_modules/`, `dist/`, `*.app`, `.DS_Store`. The other five templates all ignore `.crust/`.
  `src/bridge/server/events.ts:28` still declares `RELOAD_FILE = ".crust/dev-reload"` and
  `src/cli/dev.ts:178-183` still writes it into the project directory, so plain-HTML dev
  creates an untracked scratch file in a fresh scaffold.

---

## Checked and clean

- **Grant correctness** — `scripts/release/template-security.test.ts` covers default, react,
  next, svelte, vue; all five configs grant `app:greet`, matching the command their page calls
  (fix `ce1f65b` holds). Solid's config was read directly and is also correct; see F1 for the
  gate gap.
- **Quit wiring** — all six `templates/*/main.ts` register `window-all-closed`
  (`scripts/release/template-frameworks.test.ts:91-98` asserts this). The hunt-20 "Next never
  quits" finding is fixed.
- **Flags and file counts** — `src/cli/argv.ts:15` lists all five framework flags;
  `src/cli/init.ts:8-15` maps all six templates; `scripts/build-standalone.ts:21-27` expects
  next 8, react 6, svelte 7, vue 7, solid 9, plain 6. Each matched the files present
  (`rg --files --hidden templates`, dotfile glob excluded by `Bun.Glob` in `init.test.ts:33-39`).
- **Pinned versions** — queried the registry for every pin: `@solidjs/web` 2.0.4, `solid-js`
  2.0.4, `@solidjs/vite-plugin` 3.0.1, Vite 8.3.8, Next 16.4.6, React 19.3.1, TypeScript 7.0.2,
  `@types/node` 26.6.7 (pin `^26.6.6`), Svelte 5.59.1 (pin `^5.57.3`), Vue 3.5.46 (pin
  `^3.5.45`), `@vitejs/plugin-react` 6.3.0, `@vitejs/plugin-vue` 6.0.11,
  `@sveltejs/vite-plugin-svelte` 7.3.2. All exist; all caret pins admit the current release.
- **Solid 2 API claims** — `@solidjs/web@2.0.4` exports `render` through its `browser` condition;
  `solid-js@2.0.4` re-exports `onSettled`, and its docs say a cleanup function returned from an
  owned `onSettled` is honoured. The template's `render(() => <App />, container)` and
  `onSettled(() => { …; return () => { alive = false } })` are valid.
- **Vite client ordering** — `src/vite.ts:112-125` injects `window.__CRUST__` before the page
  client, both with `injectTo: "head-prepend"`. Vite 8 `applyHtmlTransforms` serialises tags in
  array order (`injectToHead(html, headPrependTags, true)`), so the client sees `__CRUST__` set.
- **Next port pinning** — `next dev -p 3000` is strict: `next-dev.ts:407-408` sets
  `allowRetry = portSource === 'default'`, so an explicit `-p` does not silently move ports.
- **Release workflows** — all six `templates/*/.github/workflows/release.yml` are byte-identical.
  They call only commands crust has, and `actions/checkout` v7.0.1 / `oven-sh/setup-bun` v2.2.0
  are the current major tags. `bun install --frozen-lockfile` with no committed lockfile was
  probed and succeeds.
- **Residual gap, not a finding** — `scripts/verify-package/phases/travel.ts:17` checks tarball
  travel for only `default`, `react`, `next`, while `package.json:21-29` ships the whole
  `templates/` tree and `src/cli/doctor/build-assets.ts:79` checks all six. A packaging change
  that dropped svelte/vue/solid would be caught by doctor, not by `verify-package`; no current
  failure exists.
