# Data-side plugins (fs, fs-scope*, store, store-file, stronghold, clipboard, clipboard-image, downloads, downloads-scope, network, network-rules)

## Findings

### 1. A dangling symlink escapes the fs scope — HIGH
`src/plugins/fs-scope-path.ts:20`
`canonical()` calls `realpath(absolute)`; when the leaf is a symlink whose target does not exist (or has a missing component) `realpath` fails, and the fallback resolves only the parent and re-appends the symlink's own name. The check therefore sees the in-scope symlink path while the following `Bun.write(file, contents)` in `fs.ts:127` follows the symlink and writes to its target outside the scope.
**Breaks:** A page confined to its data directory writes to any path a pre-existing dangling symlink points at, defeating the whole `fs.scope` boundary.
**Evidence:** probe: `link -> /tmp/.../outside/secret.txt` (target absent); `canonical(link)` returns the in-scope `.../scope/link`, `contains(scope, canonical) === true`, then `Bun.write(link, "PWNED")` created `/tmp/.../outside/secret.txt` containing `PWNED`. The comment at `fs-scope-path.ts:17-18` even claims the check names "the directory a write will land in rather than the symlink in front of it" — the exact opposite for this case.
**Fix shape:** detect a symlink leaf with `lstat`/`readlink` and resolve its target even when the target is missing (lexically append the remainder), or reject symlink leaves in scope commands.

### 2. A dangling symlink escapes the downloads destination check — HIGH
`src/plugins/downloads-scope.ts:36`
`destination()` checks `inside(canonical(root), canonical(target))`, but its `canonical()` has the same missing-leaf fallback as the fs scope: a symlink whose target does not exist resolves to the symlink's own in-scope path, so the check passes. The function returns the original `target` (`downloads-scope.ts:67`), which WebKit then writes through to the outside target.
**Breaks:** `downloads.setDirectory` accepts a directory whose path is a dangling symlink to anywhere on disk; downloads land outside the app's data root.
**Evidence:** probe: `destination(scope, danglingLinkInsideScope)` returned `.../scope/dllink` (accepted) though `dllink -> .../outside/dl.txt`; no `bad-request` was thrown. The test suite only covers a symlink to an **existing** outside dir (`downloads-scope.test.ts:44`), which `realpath` catches.

### 3. `fs.list` follows a symlink out of scope for an unchecked size read — MEDIUM
`src/plugins/fs.ts:138`
After `scoped(dir)` bounds the directory, `list()` calls `statPath(full)` on each entry. For a symlink entry `entry.isDirectory()` is false, so `stat` follows the link to its target without any `scope.check` on that target — an implicit read of a path the scope would refuse directly.
**Breaks:** A page confined to its data directory learns the existence and exact byte size of any file a symlink inside the scope points to, while `fs.stat` on that same target correctly answers `outside-scope`.
**Evidence:** probe: scope dir contains `leak -> <outside>/secret.dat` (12345 bytes). `list` returned `{ name: "leak", size: 12345 }`; `stat({path:<outside>/secret.dat})` answered `code: "outside-scope"`. The declared size is the target's, not the link's.

### 4. `clipboard.readImage` treats a zero-length non-byte answer as an empty pasteboard — LOW
`src/plugins/clipboard-image.ts:41`
`png.length === 0` is checked before `png instanceof Uint8Array`, so any zero-length non-byte value from an adapter is reported as `{ ok: true, png: null }` (empty clipboard) rather than the typed `handler-error` the next lines intend. `clipboard-image.test.ts:67` claims to prove "an adapter answering something other than bytes is refused" but uses a 9-character string, so the zero-length path is never exercised.
**Breaks:** A host adapter that returns `""` or `[]` for "no image" instead of the documented `null` silently reads as an empty pasteboard; the adapter mistake is hidden.
**Evidence:** probe with `readImage: () => ""` returned `{ ok: true, png: null }`, not `{ ok: false, code: "handler-error", ... }`.

## Coverage

Read in full: `fs.ts`, `fs-scope.ts`, `fs-scope-path.ts`, `fs-scope-store.ts`, `fs.test.ts`, `fs-scope.test.ts`, `fs-scope-tamper.test.ts`, `fs-scope-grants.test.ts`; `store.ts`, `store-file.ts`, `store.test.ts`, `store-corrupt.test.ts`; `stronghold.ts`, `stronghold-crypto.ts`, `stronghold-file.ts`, `stronghold-types.ts`, `stronghold.test.ts`, `stronghold-kdf.test.ts`; `clipboard.ts`, `clipboard-image.ts`, `clipboard-contract.ts`, `clipboard-image.test.ts`; `downloads.ts`, `downloads-scope.ts`, `downloads-types.ts`, `downloads-fake.ts`, `downloads.test.ts`, `downloads-scope.test.ts`; `network.ts`, `network-rules.ts`, `network-match.ts`, `network-types.ts`, `network-url.test.ts`, `network-body.test.ts`. Traced the darwin `downloads.ts` adapter and `shim/downloads/20_delegate.c` to confirm WebKit writes to the path the plugin's `destination()` returns. Read the files guide and `api-web` docs for contract claims.

Verified by ad-hoc probes against the real modules in a temp directory (no source writes, no suite run): the dangling-symlink escapes (findings 1 and 2), the `list` size leak (finding 3), and the clipboard ordering bug (finding 4).

Checked and found no defect: `store` keys including `__proto__` do not collide with file metadata (the file is a plain `{key:value}` object with no metadata; computed-key spread makes `__proto__` an own property, confirmed by probe); `stronghold` seals every name and value before any disk write and removes its temp file on failure, so no plaintext path exists; `fs.writeTextFile` promises no atomicity in docs, so the lack of fsync/rename alone is not a contract break. `patternMatches`, `readRules`, `assertJsonValue`, and the atomic temp+rename writers in `store-file.ts` / `stronghold-file.ts` / `fs-scope-store.ts` were reviewed and look correct.

Not read: `network-fake.ts`, `network-pattern.test.ts`, `network-match.test.ts`, `network.test.ts`, `clipboard.test.ts`, `downloads-*` platform shims beyond the delegate, and `shell.ts` / `updater-*` / the rest of `window-persist-store.ts` (other hunters' areas). Next I would look at the platform-side `WKURLSchemeHandler` origin gate on Linux (WebKitGTK sends no `Origin` on same-origin `EventSource`) and whether the stronghold/store temporary files survive a crash between `writeFile` and `rename`.
