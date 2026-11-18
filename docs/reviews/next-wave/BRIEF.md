# Next wave: what to build next

Three lanes, disjoint areas, each hunting in its own field and writing one report. The question is
what crust should do next, and the answer has to be evidence, not opinion.

## Shared rules

- One tree, no worktree. Work in `~/dev/crust`.
- `rg`, never `grep`/`find`. `fd` for paths. Never scan from `/`, `~` or a repo root without a path.
- Run every build and test in the foreground and wait for it inside the same call.
- `bun check` is the type gate, `bun run test` is the suite (never bare `bun test` — it sweeps the
  vendored `research/electrobun` mirror). `bun run check:lines` is the 200-line cap.
- Never run `bun fmt` without an explicit path list.
- Never `open` a built bundle; never move the cursor or synthesize input on the user's screen.
- Do not write to the global `AGENTS.md`. Your findings go in your own report plus
  `docs/agents/<lane>.md` if you learned a trap worth keeping.
- No file over 200 lines, reports included.
- A claim needs a command behind it. Quote the command, not just the number.
- Only touch the files your lane owns. Do not refactor, do not "improve what you saw", do not fix
  another lane's area even if you spot something — report it.

## Lane 1 — platform gaps (`platform-gaps`)

Field: the three platform arms. What does darwin answer that linux and windows refuse, and why?

Read `src/platform/{darwin,linux,windows}/`, `src/runtime-plugins.ts`, `src/runtime-keychain.ts`,
`site/app/docs/reference/parity/page.mdx`, `site/app/docs/limits/page.mdx`.

Produce: every capability that is `not-implemented` on linux or windows, with the file and line that
refuses it, the native API that would answer it, and whether that API is genuinely reachable from a
Bun `dlopen`/`bun:ffi` binding (libsecret, WebKitGTK find, CredEnumerateW, and whichever else you
find). Rank by how likely a real app hits it. Say plainly which ones are cheap, which are a project,
and which should stay refused.

Report: `docs/reviews/next-wave/platform-gaps.md`.

## Lane 2 — defects (`defects`)

Field: correctness and security defects in the code as it stands. Find bugs, not features.

Look wherever defects live: `src/bridge/`, `src/platform/*/shim/*.c`, `src/plugins/`, `src/cli/`,
`src/packaging/`, `scripts/`. Read the tests to see what is *claimed*, then check the claim against
the code — a test that passes for the wrong reason is a defect. Prefer a real failing path over a
hypothetical: state how the bad state is reached, or drop it.

For each finding: file:line, what is wrong, how it is reached, and the smallest fix. If you can
prove it with a failing test, write the test and show it red — but do not fix it, and do not leave a
red test in the tree (revert your test files before you finish, or write them under
`docs/reviews/next-wave/probes/` where the suite does not collect them).

Report: `docs/reviews/next-wave/defects.md`. Rank by severity.

## Lane 3 — capability gaps (`capability-gaps`)

Field: what a desktop framework needs that crust has no answer for at all. Not a Butter row — the
parity table covers that. Think about the whole job: building, shipping, updating, debugging and
supporting a real app.

Read `site/app/docs/limits/page.mdx`, `site/app/docs/design/page.mdx`, `src/cli/`,
`src/packaging/`, `scripts/`, `examples/`, `templates/`.

Produce: the gaps a person would hit on day two — the things that are absent rather than partial.
For each: what the user tries to do, what happens today, what the smallest honest answer is, and
whether Butter or Tauri has it. Be concrete about cost.

Report: `docs/reviews/next-wave/capability-gaps.md`.

## Final message

Under 12 lines. Bullets. The top three items you would do next, in order, one clause each.
