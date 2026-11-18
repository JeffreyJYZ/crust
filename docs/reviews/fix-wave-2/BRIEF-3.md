# Fix wave, third brief: the leftovers the first two waves surfaced

Same shared rules as `docs/reviews/fix-wave-2/BRIEF.md`. One tree, `rg`/`fd`, foreground builds,
200-line cap, never `bun fmt` without paths, only your own files, quotes over numbers.

**Hand focus back when you finish.** If anything in your run launched or activated a GUI app — a
`crust dev`, an `e2e:*`, a built bundle — capture the frontmost app *before* you start and restore
that same app afterwards, falling back to `open -a Ghostty` only when the capture failed. A lane that
leaves a test window in front of the person using this machine is a defect, not a detail.

Lanes F1–F9b and W1–W2 already own their areas. Do not touch anything they changed. The files below
are the ones every previous lane reported as "out of scope, not fixed".

## Lane L1 — `fix-template-locale`

Three templates bind `dir` and `lang` from the locale (F7 did react/vue/svelte). Two were left out of
scope and now hardcode English, which is worse than none because it looks finished:

```
templates/next/app/layout.tsx:13        <html lang="en" style={{ colorScheme: "dark light" }}>
templates/default/public/index.html     lang="en" if present
```

Read `src/plugins/i18n-locale.ts` (F7 added `textDirection` and `localeAttributes`) and bind the same
way the three fixed templates do. For `next`, it is a server-rendered static export, so the value has
to come from `crust.config.ts` at scaffold time or from a small client effect — pick whichever the
existing template shape supports and say which.

Own: `templates/next/app/layout.tsx`, `templates/next/**` for that binding only,
`templates/default/public/index.html`, and a test beside the template tests.

Prove: the template test asserts `lang` and `dir` are not the literal `"en"`/`"ltr"` hardcode, and
`bun run e2e:single` plus `bun run e2e:notes` still pass.

## Lane L2 — `fix-sidecar-everywhere`

F4 wired `build.sidecars` into `crust build`. Three other paths still drop it:

1. `src/cli/single-app.ts` — single-file mode never writes a sidecar manifest.
2. `src/packaging/installers*` — packaged installers copy the app but skip sidecars.
3. `src/cli/util.ts` — a naive resolver.

Read `src/packaging/build.ts` and `src/cli/build.ts` to see exactly what F4 did, and reuse that code
rather than writing a second copy.

Own: `src/cli/single-app.ts`, `src/packaging/installers*.ts`, `src/cli/util.ts`, and tests beside
them. Do not touch `src/cli/build.ts` or `src/packaging/build.ts` — F4 and F9b own those.

Prove: a built app in single-file mode names its sidecars, and `bun run e2e:single` stays 27/27.

## Lane L3 — `fix-comment-drift`

Three code comments still state numbers the docs no longer do. F5 corrected the docs and flagged
these because they sit in `src/`:

```
src/platform/darwin/shim/50_app.c:72      "0.25 ms" pump interval; measured optimum is 4 ms / 2 ms
src/app-types.ts:94                       same claim
README.md:57                              "~85 MB" — measured 86.18 MiB compiled, 85.68 signed
site/app/docs/evidence/page.mdx           cold-start 790.1 ms vs perf.md's 1,322.5 ms
```

Read `docs/reviews/next-wave/perf.md` for the measured numbers and `site/app/docs/limits/page.mdx`
for how F5 phrased them. Correct each to what was measured. Where the two measurements disagree (the
evidence page's 790 ms versus perf's 1,322 ms), say which machine and which conditions each one came
from rather than picking one — a number with no conditions is the defect.

Own: `src/platform/darwin/shim/50_app.c`, `src/app-types.ts`, `README.md`,
`site/app/docs/evidence/page.mdx`.

Prove: `bun run site:build`, `bun run check:links`, `bun run check:parity`, and
`clang -fsyntax-only -std=c99 -Wall` on the assembled shim source.

## Final message

Under 12 lines. Bullets. What changed, what proved it, what you left alone.
