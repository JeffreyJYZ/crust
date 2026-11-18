# Two fixes from the SKILL.md blind test

A fresh lane was given only `https://crust.jyz.land/SKILL.md` and asked to build a working app
without reading this repo. It succeeded — window opened, `add` command answered, counter persisted
across three restarts, `bun run build` produced a signed `.app`. It also reported five places it had
to guess. Two of those are defects, not documentation gaps.

Shared rules: one tree, `rg`/`fd`, foreground builds, 200-line cap (split, never trim), never
`bun fmt` without a path list, only your own files.

**Hand focus back when you finish** — wrap any GUI run in `probe-run -c '<command>'`.

## Lane S1 — `init-pins-the-tag`

The blind test's finding 4:

> doc says install `#v0.1.29`, but scaffold `package.json` depends on unpinned
> `github:JeffreyJYZ/crust`; `bun install` resolved commit `57a6fed`.

That is a real defect. `src/cli/init.ts:155`:

```ts
return isCheckout ? `link:${root.replaceAll("\\", "/")}` : "github:JeffreyJYZ/crust";
```

Run `crust init` from a release tag and the scaffold depends on whatever `main` is when the user
runs `bun install`. Two people scaffolding a week apart get different code, and neither gets the
version they asked for.

Fix: pin the version the CLI is running. `VERSION` already exists in `src/cli/util.ts` (it is
`package.json`'s version), so the non-checkout branch should name the tag:
`github:JeffreyJYZ/crust#v<version>`.

Careful, and say what you did about each:

- The checkout branch stays `link:` — a checkout is a live tree on purpose.
- A version that is not a release tag (a local build with `0.1.30-dev` or similar) must not produce a
  tag that does not exist. Decide: pin only when the version looks like a release (`/^\d+\.\d+\.\d+$/`),
  otherwise fall back to the unpinned form and say why in a comment.
- `crust init` must still work from a `bunx` cache path, where the tree is not a checkout.

Own: `src/cli/init.ts`, `src/cli/init.test.ts`, and any doc line that states what `init` writes
(`site/app/docs/start/install/page.mdx` mentions `link:<the CLI's own tree>`).

Prove: a test that a release version yields `github:JeffreyJYZ/crust#v<version>` and a `-dev`
version does not; `bun run test`, `bun check`, `bun run check:lines`. Then actually run
`bun run src/cli/index.ts init <tmpdir>` from this checkout and show what it wrote — a checkout
yields `link:`, so also show the pinned branch through the test.

## Lane S2 — `skill-md-fills-the-gaps`

Expand `site/public/SKILL.md` with the four documentation gaps the blind test hit. Keep it under
200 lines if you can; if a table pushes it past, the file may go to ~230 — it is `.md`, so
`check:lines` does not scan it, but an agent has to read it, so shorter is better. Do not pad.

1. **The plugin commands.** The file names 31 namespaces and documents none, so the lane guessed
   `store.get`/`store.set` and got lucky. Add a compact command table for the eight a first app
   reaches for — `store`, `fs`, `dialog`, `window`, `notification`, `clipboard`, `shell`, `tray` —
   with the command names and the argument shape only, one line each. Read
   `src/plugins/store.ts`, `fs.ts`, `dialog.ts`, `window-types.ts`, `notification.ts`,
   `clipboard.ts`, `shell.ts`, `tray.ts` for the real names and args; do not invent any.
2. **Built-ins are already registered.** `app.use` exists but nothing says the 31 namespaces work
   without it. One sentence.
3. **Each namespace needs its own capability.** The capability rules are generic; the lane had to
   infer that `store` needs `{ name: "store", actions: ["store:*"] }`. Say it explicitly, with the
   one-line example.
4. **How to verify a window opened and a command answered.** The lane invented a `report` command
   because the file offers no way to check. Give the two-line recipe the scaffold already uses:
   `app.on("ready", () => console.log("window open"))` and a command that logs its answer, then
   `bun run dev` and read stdout.

Also state plainly, near the top: this file is the working surface, and each namespace's full
command reference is at `https://crust.jyz.land/docs/reference/api` — so an agent knows where to
look when the table stops.

Own: `site/public/SKILL.md`. Nothing else.

Prove: `bun run site:build` and `bun run check:links` pass; paste the new command table and the
line count.
