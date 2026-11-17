# Lane fs-binary — Butter parity, fs binary read/write + mkdir

Fixed F0. `src/plugins/fs.ts` re-exports the new types and spreads `binaryCommands(scoped)` into its
command table; the implementations live in the split `src/plugins/fs-binary.ts` (99 lines) so fs.ts
stays at 197.

- `readBinary({path})` → `Uint8Array` via `Bun.file().arrayBuffer()`; missing path → `not-found`.
  The bridge's `encodeResult` tags it `__crustBytes` and the page client revives it — no bridge change needed.
- `writeBinary({path,bytes})` → `Bun.write`, `{bytes: n}`. Accepts a real `Uint8Array` (in-process /
  binary route) **or** `{ __crustBytes: base64 }` from a JSON argument: JSON.stringify turns a page's
  Uint8Array arg into numeric keys, so the tag is the only JSON-safe form. Base64 is validated
  (length % 4, charset) before decode; bad tag or non-bytes → `bad-request`.
- `mkdir({path})` → recursive, `{path, created}`; `created` is measured from Node's first-created
  return (`undefined` when the chain existed), not a prior stat.

All three call the plugin's existing `scoped()` → `scope.check()`, so a symlink/`..` escape and the
scope-store guard are the same rules as text fs — no second containment rule.

Tests: `src/plugins/fs-binary.test.ts` (7) — exact bytes incl. non-UTF8, missing path, real + tagged
write, invalid tag/non-bytes, recursive mkdir idempotence, and all three refusing an out-of-scope path.
Verification: `bun test` 7/7, `bun check` clean, `bun fmt` per file, `check:lines` pass, parity row flipped.
