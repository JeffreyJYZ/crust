# Validation: what an agent can actually check

`site/public/SKILL.md` has one short "Verify it runs" section and nothing else about validation. An
agent following it can confirm a window opened and one invoke answered — and cannot tell a healthy
app from one whose bridge is misconfigured, whose assets are missing, or whose single-instance lock
was never taken.

Write a **Validate an app** section. Every claim must come from the source, not from prose that sounds
plausible.

## The layers, as they exist

1. **`crust doctor`** — one line per launch check, exit 1 on any failure. Read `src/cli/doctor/*.ts`
   for the real check names and what each one asserts. The measured set is: `assets`, `backend`,
   `bridge`, `bundle`, `gatekeeper`, `localhost`, `shim`, `single`, `source`, `templates`, `trap`,
   `window`. Say what a reader learns from a red line, and that it needs no bundle to run.

2. **`crust build`** — the exit code and the named artefact. Say what each platform produces: macOS
   assembles `X.app` and ad-hoc signs it (so Gatekeeper refuses it on another machine until a
   Developer ID signature exists), Linux and Windows produce a flat binary. Use the exact refusal
   wording only if you can quote it from source.

3. **Run it** — launch `X.app/Contents/MacOS/<bin>` directly, never `open`, which routes through
   LaunchServices and hides which process ran. Read `examples/hello/main.ts` for the stdout markers
   the scaffold prints, and keep the existing "no `report` command" statement, because that is the
   question every agent asks first.

4. **The round trip** — the page's `window.crust.invoke` reaching a handler and answering is the
   proof both directions work. Quote the actual marker from `examples/hello/main.ts`.

5. **What a failure looks like** — the failure codes table already covers this; point at it rather
   than repeating it. `forbidden` after adding `security.capabilities` is the one an agent will hit
   first, so name it with the fix.

## Rules

- No invented commands, flags or output. If a claim is not in `src/` or in the docs, it does not go in.
- The existing `### Verify it runs` material should survive, folded into the new section rather than
  duplicated in two places.
- The generated `skill:commands` region between the markers is untouched. Prose only. The root
  `SKILL.md` is a symlink to this file — edit the real file.
- Keep it as prose plus at most one code block: this is a map of what to check, not a second manual.

Own `site/public/SKILL.md` only. No `site/app/docs/**`, no `src/**`, no `scripts/**`.

Prove, pasted: `bun run skill:check`, `bun run check:links`, `bun run site:build`, plus the new
section quoted in full. Final message under 10 lines.
