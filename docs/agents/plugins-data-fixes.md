# plugins-data — findings from 07-plugins-data.md

## Status: all four findings real and fixed

All four held. Each has a test that fails on HEAD's source and passes with the fix (verified by restoring
`git show HEAD:` copies of the four sources, running the new cases — 5 failures — then restoring the fix).

## 1. Dangling symlink escapes the fs scope — HIGH, fixed

`src/plugins/fs-scope-path.ts:20` — `canonical()` now `readlink`s a path whose `realpath` failed and
resolves the link's own target before falling back to the parent. A `seen` set bounds a link cycle, which
would otherwise recurse forever (a self-referential symlink makes `realpath` fail with `ELOOP`, so the
parent-only fallback used to hide that case: it returned the link path too).

The escaping case is exactly the one the old comment got wrong, so the comment was rewritten rather than
left claiming the opposite of what the code does.

`src/plugins/fs.ts` needed no change — every `fs` command already goes through `scope.check`, which calls
`canonical`, so the corrected resolution refuses the write before `Bun.write` sees the path.

Test: `src/plugins/fs-scope-dangling.test.ts` — a write through a dangling in-scope link is refused and
the target stays absent; a read through the same link is refused; a dangling link pointing back inside the
scope still writes and reads.

## 2. Dangling symlink escapes the downloads destination check — HIGH, fixed

`src/plugins/downloads-scope.ts:36` — same defect in the sync `canonical()`: `readlinkSync` on a failed
`realpathSync` resolves the link's target, `seen` bounds a cycle. `destination()` is otherwise unchanged,
so the returned path is still the page's own and WebKit still writes the name it asked for.

Test: `src/plugins/downloads-scope.test.ts` — a dangling in-root link to an absent outside path is
refused, a path one level below it is refused too, and a dangling link pointing back inside the root stays
accepted (so an app is not broken by its own uncreated tree).

## 3. `fs.list` follows a symlink out of scope for a size read — MEDIUM, fixed

`src/plugins/fs.ts:138` — the size read moved into `entrySize()`, which runs `scope.check(full)` before
`stat` when the dirent is a symlink, and reports `size: 0` when the target is out of scope. The entry stays
listed (its existence inside the scope is not a secret), only the target's byte count stops leaking. With
no scope configured `check` is a no-op, so unscoped apps keep the old behaviour.

Test: `src/plugins/fs-scope-dangling.test.ts` — a link to a 12345-byte out-of-scope file lists as `size: 0`
while `stat` on the same target still answers `outside-scope`; an in-scope link still reports 4; an
unscoped plugin still reports the target's size.

## 4. `clipboard.readImage` reads a zero-length non-byte answer as empty — LOW, fixed

`src/plugins/clipboard-image.ts:41` — the `instanceof Uint8Array` test now runs before the length test, so
`""` and `[]` are `handler-error` and only real zero-length bytes mean an empty pasteboard.

Test: `src/plugins/clipboard-image.test.ts` — both `""` and `[]` answer `handler-error` with the
"did not return image bytes" message.

## Checks

- `bun test src/plugins/fs-scope-dangling.test.ts src/plugins/downloads-scope.test.ts
  src/plugins/clipboard-image.test.ts src/plugins/fs.test.ts src/plugins/fs-scope.test.ts` — 38 pass.
- `bun fmt <the seven changed files>` — unchanged.
- `bun run check:lines` — PASS.
- `bun check` — no error in `src/plugins/**`. Remaining errors belong to other lanes:
  `src/cli/parse.ts:63` (×2), `src/platform/linux/platform.test.ts:13`.

## Durable notes

- **A dangling symlink is invisible to a parent-only canonicalisation, in *both* the async and sync
  variants** — `realpath` fails because the target is absent, so the fallback re-appends the link's own
  name and the containment test passes while the write follows the link. Read the link, do not just walk
  up. `fs-scope-path.ts` and `downloads-scope.ts` now each carry that rule with a cycle bound.
- **`realpath` on a self-referential symlink fails `ELOOP`, which lands in the same "missing leaf"
  branch** — the `seen` guard is what stops both escapes from turning into an infinite recursion once the
  link is followed.
- **A size read is a read.** `fs.list` must ask the scope about a symlink's target before `stat`, or it
  reports bytes for a path `fs.stat` refuses.
