# `fs` scope escape: a lexical `..` fold against a raw path

Found by the fs hunt (`docs/reviews/hunt-20/02-fs.md`, Critical). Reproduced against the real plugin, not
read off the page.

## The mechanism

`src/plugins/fs-scope-path.ts`:

```ts
export async function canonical(path: string, seen = new Set<string>()): Promise<string> {
    const absolute = resolve(path);          // ← folds `..` LEXICALLY
    const found = await realpath(absolute).catch(() => undefined);
    ...
}
```

`resolve()` collapses `..` as text. `realpath()` then resolves whatever that collapsed path names. So
`<scope>/link/../secret.txt` is checked as `<scope>/secret.txt` — inside the grant — while the command
that runs afterwards (`readTextFile`, `writeTextFile`, `rename`, `remove`, …) is handed the **raw**
string, and the OS resolves `link/..` through the symlink's target. If `link` points at a directory
outside the scope, the page reads, writes, renames or deletes a file outside its grant.

The scope is the security boundary for a page, so this is the one class of bug that must not wait.

## What to do

1. **Reproduce it first, in a test.** A temp dir as the scope, a symlink inside it pointing at a
   directory outside, then `fs.readTextFile` on `<scope>/link/../outside.txt`. The test must fail
   against today's code with the outside file's contents — that failure is the deliverable, and it is
   what proves the fix is a fix rather than a change.
2. **Fix the fold, not the call sites.** `canonical()` must resolve `..` the way the filesystem does —
   through the link — or the check and the command must agree on one path. Options, in order of
   preference:
   - resolve the real path of the **raw** string (no `resolve()` first) so `realpath` sees `link/..` and
     answers the true location;
   - or return the canonical path from the check and **use that** for the operation instead of the raw
     string, so the thing that was checked is the thing that runs.
   Whichever you choose, say why, and make sure it holds for the missing-leaf case the existing comment
   describes (a write into a directory that does not exist yet, and a dangling symlink) — that fallback
   is there for a real reason and must not regress.
3. **Check every caller.** `rg` `canonical(` across `src/` — the store's own path, `scopeAllow`,
   `scopeRevoke`, and anything else that compares a path. A fix in one caller is not a fix.
4. **Keep the case-folding and the store-path refusal** (`samePath`, the `scope.json` guard). Those are
   deliberate and tested.
5. **Add the regression test** to the suite that already covers scope, and name it so a future reader
   sees what it prevents.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Do not weaken a test to make it pass**, and do not widen a scope to make a case legal.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/plugins/fs-scope-path.ts`, `src/plugins/fs-scope.ts`, and the fs tests. Nothing else — other lanes
are hunting the same tree.

## Prove, and paste the output

- The failing test **before** the fix, with the outside file's contents in the output.
- The same test green after, plus `bun test src/plugins`, `bun run test`, `bun check`,
  `bun run check:lines`.
- The other callers you checked, named.

Final message under 10 lines: which fix you chose, what the escape test asserts now, and any caller you
left alone and why.
