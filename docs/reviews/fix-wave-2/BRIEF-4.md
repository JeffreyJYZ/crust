# Fix wave, fourth brief: the gaps the hunt named that no lane has taken

Same shared rules as `docs/reviews/fix-wave-2/BRIEF.md`. One tree, `rg`/`fd`, foreground builds,
200-line cap, never `bun fmt` without paths, only your own files, quotes over numbers.

**Hand focus back when you finish.** If anything in your run launched or activated a GUI app — a
`crust dev`, an `e2e:*`, a built bundle — capture the frontmost app *before* you start and restore
that same app afterwards, falling back to `open -a Ghostty` only when the capture failed. A lane that
leaves a test window in front of the person using this machine is a defect, not a detail.

Lanes F*, W*, L1–L3 own their areas. These are the items their reports named as someone else's, plus
the gaps nobody was assigned.

## Lane L4 — `fix-app-command-grants`

`docs/reviews/next-wave/api-design.md` finding 1: page-called app commands go through
`app.command`/`typedHost` and are gated only as `app:invoke`, so a grant written `notes:*` covers
nothing and `app:invoke` grants every app command at once. Read `src/plugins/app*.ts`,
`src/bridge/server/invoke.ts` (now carrying `authority`), `src/config/validate-security.ts`.

Decide the action mapping: an app command named `notes.save` must be checkable as `app:notes.save`,
or you must argue why one flat action is right and document it. Whatever you pick, a page holding
`app:invoke` must not silently gain every app command when the app author wrote narrower grants.

Own: `src/plugins/app*.ts`, `src/bridge/server/`, `src/config/validate-security.ts`, and tests beside
them. Coordinate: `src/bridge/server/` was just changed by Lane F1 — re-read before writing.

Prove: a test with grants `{ main: ["app:notes.*"] }` where `notes.save` succeeds and `notes.delete`
is refused by name.

## Lane L5 — `fix-updater-platform`

`docs/reviews/next-wave/packaging.md` finding 2: the updater is registered on every platform, but its
install path checks for an `.app` bundle and relaunches with `open -n`, so it cannot work on Windows or
Linux. Either implement those, or make the plugin refuse by name on those platforms and say so in the
docs — a silent half-feature is the defect.

Read `src/plugins/updater*.ts`, `src/runtime-plugins.ts`, `site/app/docs/limits/page.mdx`.

Own: `src/plugins/updater*.ts`, `src/runtime-plugins.ts`, `site/app/docs/limits/page.mdx`, tests
beside them. Do not touch `src/plugins/updater-url.ts`'s policy — F2 just fixed it.

Prove: a test that the refusal names the platform, or a Linux/Windows install path with a test.

## Lane L6 — `fix-first-run-ux`

`docs/reviews/next-wave/first-run.md`:

1. `crust dev` and `crust build` in a directory with no config say what is missing but never name
   `crust init`.
2. `crust bogus --help` exits 0 and prints the global help, so a typo looks like success.
3. `--help` is one wall of text for every subcommand.

Own: `src/cli/**` argument handling and error messages, tests beside them. Do not change a behaviour
a test pins; if one does, say which and why.

Prove: a test per item — a missing-config error containing `crust init`, a non-zero exit for an
unknown subcommand with `--help`, and a subcommand-scoped help.

## Lane L7 — `fix-release-scaffold`

`docs/reviews/next-wave/capability-gaps.md`: the three items its top-3 named.

1. **Update publisher** — no CLI writes the manifest or signs the artifact the updater consumes. Add
   the command that does it, or document that `crust build` output is what you point the updater at.
2. **Cross-compile note** — `crust build` is host-only; `crust init` ships no CI workflow. Add a
   GitHub Actions workflow to the scaffolds, or document the one command to run.
3. **Release scaffold** — `crust release` plus a template workflow.

Do the smallest honest version of each. A documented "here is the command" beats a half-built CLI.

Own: `src/cli/`, `templates/*/.github/workflows/**` (new files only), `site/app/docs/guides/**` (new
page only if you add one), tests beside them. Do not edit an existing template page or config.

Prove: each addition has a test or a command you ran and pasted.
