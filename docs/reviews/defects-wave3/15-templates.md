# Templates and examples

## Findings

### 1. React template `bun run build` builds the frontend twice — MEDIUM
`templates/react/package.json:8`
The `build` script runs Vite, then `crust build`, which unconditionally runs
`beforeBuildCommand` — the same Vite build — again. The first build's output is
overwritten by the second; the script doubles frontend build time for no result.
**Breaks:** every `bun run build` in a scaffolded React app runs Vite twice; an e2e
or CI build pays double.
**Evidence:** `templates/react/package.json:8` is
`"build": "bun --bun ./node_modules/.bin/vite build && crust build"`, and
`templates/react/crust.config.ts:13` sets
`beforeBuildCommand: "bun --bun ./node_modules/.bin/vite build"`. `src/cli/build/resolve-assets.ts:27-30`
runs that command on every `crust build` with no dedup. The script is untested:
`scripts/first-run.ts:86` calls `crust build` directly, never `bun run build`.

### 2. Docs' `--next` scaffold file list omits the `/about` route — MEDIUM
`site/app/docs/start/files/page.mdx:42`
The `--next` row lists eight files ending `app/page.tsx`, `package.json`,
`.gitignore`, but the emitted tree also contains `app/about/page.tsx`, which the
standalone gate counts. A reader following the documented layout misses a route.
**Breaks:** the docs disagree with the scaffold on its structure; the second route
the docs demonstrate elsewhere is invisible in the file list.
**Evidence:** `site/app/docs/start/files/page.mdx:42` reads
`crust.config.ts`, `main.ts`, `next.config.mjs`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `package.json`, `.gitignore`;
`templates/next/app/about/page.tsx:1` exists, and `scripts/build-standalone.ts:95`
pins the `--next` count at 8 non-dot files (7 without `/about`).

### 3. Dogear self-check step numbers are off by one — LOW
`examples/dogear/src/selfcheck/panels.tsx:2`
The header says "Steps 9–10" and the comments say step 9/10, but
`selfcheck/steps.tsx` emits nine separate `check(...)` results (one per PASS
line), so the two panels are steps 10 and 11. The README's "eleven steps" and
its 11 sample PASS lines are right; its layout line "steps.tsx (1-8), panels.tsx
(9-10)" is wrong too.
**Breaks:** nothing at runtime; the comments and README misdescribe the sequence
they claim to document.
**Evidence:** `steps.tsx` has `await check(` at lines 50, 74, 82, 93, 107, 123,
133, 143, 149 — nine results; `panels.tsx:2` says `Steps 9–10`;
`examples/dogear/README.md:181` says `steps.tsx (1-8), panels.tsx (9-10)` while
`README.md:122` says `That is eleven steps`.

### 4. The 200-line gate never checks `templates/` — LOW
`scripts/line-cap.ts:10`
`check:lines` walks `src`, `scripts`, `examples` and `site` but not `templates`,
despite the repo rule that every file is capped at 200 lines. A template that
grows past the cap passes the gate.
**Breaks:** a gate hole, not a current failure — all template files measure at
or under 200 lines today (checked by line count over `rg --files templates`).
**Evidence:** `const ROOTS = ["src", "scripts", "examples", "site"];`

## Coverage
Read every file under `templates/` (all three scaffolds, their `package.json`,
config, page and asset files) and `src/cli/init.ts`, `src/cli/assets.ts`,
`src/cli/util.ts`; the template-rendering path (`listAssets`, token substitution,
`gitignore` rename, the standalone file-count check in `scripts/build-standalone.ts`)
and the docs that describe the emitted trees (`start/files`, `start/first-app`,
`start/install`, `guides/frontend`, `guides/package`). Traced every import from
`examples/` into `crust`, `crust/plugin`, `crust/extension`, `crust/vite` and
relative `src/` paths against the actual export barrels — all resolve. Checked
registry versions for every template dependency pin against `bun info` (all match
current latest). Checked line counts of all template and example files (none over
200). Checked the `link:` question: `{{crust_dep}}` becomes an absolute `link:`
only when `crustRoot/.git` exists (a checkout); bun's `github:` installs keep no
`.git`, so documented `bunx github:…` flows get `github:JeffreyJYZ/crust`. This is
intentional and documented in `start/install`, so not reported as a defect.
Did not execute builds, e2e or the full suite (shared tree, per brief), so runtime
behaviour of the built templates is inferred from source. Next area of interest:
the generated dev entry and `.crust/dev.json` handoff, owned by other hunters.
