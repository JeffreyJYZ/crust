# Security wave 2 — verification of the fixes

Read-only check of `docs/reviews/security-wave2.md` against the code at `ddca36e` plus the working tree. Every fix below is judged on the code, not on a lane's claim. The tree is dirty from other sessions; where in-flight work changes an answer it is labelled.

## Table

| # | Severity | Verdict | The line that decides it | Test that fails if reverted |
| --- | --- | --- | --- | --- |
| 1 | high | **closed** (attack) / **regression** (feature dead) | `src/plugins/updater.ts:148` receipt lookup, `:156` own-bundle gate, `:161` digest recheck | `src/plugins/updater-install.test.ts:39`, `src/plugins/updater-install-target.test.ts:16` |
| 2 | high | **closed** | `src/plugins/updater-signature.ts:80` (`pinned === undefined` is `null`, never the caller's key), `:82`; `updater.ts:111` | `src/plugins/updater-download.test.ts:83`, `:102` |
| 3 | high | **closed** | `src/plugins/updater.ts:104-109` (sha256 mandatory), `src/plugins/updater-url.ts:29` (https only) | `src/plugins/updater-download.test.ts:30`, `:45`, `:62` |
| 4 | high | **closed** | `src/plugins/shell-env.ts:49-55` (any `env` refused without the host opt-in), `:56-63` (injection names) | `src/plugins/shell-attacks.test.ts:38`, `:46` |
| 5 | medium | **closed** | `src/plugins/shell-resolve.ts:52-59` canonicalises `allow` once; `:142`/`:156` compare the real path | `src/plugins/shell-attacks.test.ts:89`, `:98`, `:118` |
| 6 | medium | **closed** | `src/plugins/shell-resolve.ts:80-97` (`realpath` cwd), `:146-155` (`realpath` program, then containment) | `src/plugins/shell-attacks.test.ts:106`, `:135` |
| 7 | medium | **still open** | `src/plugins/fs.ts:178` still registers unscoped; `runtime-plugins.ts:61-64` scopes only when the config has `fs.scope` | `src/plugins/fs-scope-grants.test.ts:103` asserts the unscoped read still works |
| 8 | medium | **partly closed** | `src/plugins/fs-scope.ts:154-157` refuses `scopeAllow` unless `grants: "page"`; the remaining route is `scope.json` written through `fs.writeTextFile` | `src/plugins/fs-scope-grants.test.ts:46`, `:79`, `:91` |
| 9 | medium | **closed** | `src/plugins/network-match.ts:19-26` folds case on darwin and win32; the Linux byte-wise branch is unreachable because no non-darwin branch registers the plugin (`runtime-plugins.ts:77-85`) | `src/plugins/network.test.ts:113` |
| 10 | medium | **closed at HEAD, regressed in the working tree** | `src/plugins/network.ts:85` blocks at `>= NETWORK_URL_LIMIT`; the in-flight `URL_CHUNK = 1024` at `:26`/`:37` truncates to 1023 before that test | `src/plugins/network-body.test.ts:103` (calls `decide` directly, so it cannot see the truncation) |
| 11 | low | **closed** | `src/runtime-crash-store.ts:64` and `:65-68` (`mode: 0o600`), `:69-70` (`chmod` for a file an older build left 0644) | `src/runtime-crash-store.test.ts:28`, `:39` |
| 12 | low | **closed** | `src/plugins/crash-reporter.ts:128-136` answers `page-cannot-clear`; the only writer of a delete is `clearCrashes`, called by the runtime | `src/plugins/crash-reporter.test.ts:106` |
| 13 | low | **closed** | `src/plugins/downloads-scope.ts:36-45` canonicalises the nearest existing ancestor, `:61` compares canonical ends | `src/plugins/downloads-scope.test.ts:44` |
| 14 | low | **closed by removal** | `uniquePath` no longer exists; `downloads.ts:52` hands the directory to the adapter and WebKit names the file | none — the code path is gone |
| 15 | low | **closed** | `src/plugins/updater.ts:184` routes `relaunch` through `start`, whose gate is `updater-bundle.ts:54` → `:46` | `src/plugins/updater-relaunch.test.ts`, `src/plugins/updater-own-bundle.test.ts` |
| 16 | low | **partly closed** | `src/plugins/stronghold-file.ts:74` refuses below the floor (600 000); **no upper bound**, so a header claiming 2^40 rounds still hangs `open` | `src/plugins/stronghold-kdf.test.ts:59` (floor only) |
| 17 | low | **partly closed** | `src/config/validate-shell.ts:54-58` warns on an interpreter; the report asked for a refusal, and the docstring at `:25-27` argues against one | `src/config/validate-shell.test.ts` (warning, not a refusal) |
| 18 | medium | **still open** | `src/runtime-plugins.ts:154-191` still mounts every plugin for one caller; no `capabilities`, consent or read-only mode anywhere in `define.ts` | none |

## Regressions a fix introduced

- **`updater.install` cannot install a legitimate update with the shipped adapter.** `download` writes one *file* (`updater-node.ts:50-52`, `Bun.write(path, response)`), and `install` refuses a file (`updater.ts:158`, "extract it first") then requires the *directory* digest to equal the archive's (`:161-163`). `sha256` over a directory is `digestTree` (`updater-node.ts:20-31`), which can never equal the digest of the `.zip`/`.dmg` it was extracted from, so the only reachable outcomes are `not-an-app-bundle` or `changedSinceDownload`. The test happy path hides this because its fake adapter copies a directory into the temp dir (`updater-fake.ts:81-93`), which no real adapter does. A page-side XSS is blocked; so is the app's own update.
- **The URL-too-long guard is bypassed by the in-flight buffer shrink.** `NETWORK_URL_LIMIT` stays 2047 (`network-types.ts:20`) but the uncommitted `network.ts:26` reads the URL through a 1024-byte buffer, and `net_url(dst, cap)` copies at most `cap - 1` bytes, so JavaScript sees a 1023-byte prefix — below the threshold, so `judge` never blocks and matches a tail-anchored rule against a prefix. That is finding 10 open again for every URL over 1023 bytes. The unit test passes because it calls `decide` with a string built in JavaScript (`network-body.test.ts:109`), never through the shim.
- **An explicitly allowlisted absolute program is refused.** `shell-resolve.ts:155` tests containment in `cwdRoot` *before* `:156` tests the allow list, so `createShellPlugin({ allow: ["/opt/homebrew/bin/ffmpeg"], cwdRoot: appDir })` answers `program-outside-root` when a page passes that absolute path, which is exactly the entry the shell guide's own example names (`site/app/docs/guides/shell/page.mdx:8`). It works only when the page passes the bare name, which is an asymmetry nothing documents. Fix: when `allowed.has(actual)`, the host named that exact file, so skip the root test.
- **A symlinked `/usr/local/bin` shim or a Homebrew keg path is fine** — `canonical` (`shell-resolve.ts:52-59`) and `resolveProgram` (`:141`, `:147`) both `realpath`, so the two sides compare like with like. Not a regression.
- **A bare name the app's PATH cannot see at construction is silently dropped.** `canonical` returns `undefined` for `Bun.which(entry) === null` (`shell-resolve.ts:57-58`), so a Finder-launched app (launchd PATH) allowlisting `ffmpeg` builds an empty `allowed` set while the refusal still prints `allowed: ffmpeg` from `rules.allow` (`:108`). Reachable, and the message names a program the list does not contain.

## What a page can still reach

- **`scope.json` widening, one launch delayed.** With a scope configured, `fs.writeTextFile` may write `scope.json` whenever the app data dir is inside a configured prefix; `fs-scope-store.ts:23` accepts any absolute string, and `fs-scope.ts:77-79` reads it on the next launch. The command is gone, the file is not.
- **An enormous PBKDF2 count** (`stronghold-file.ts:74`) hangs `open` on a store file the user already owns — local write access required, which is why it stays low.
- **Everything finding 18 describes** is unchanged: one capability set, so a page in the app's origin still reaches app install, file write and program spawn together.

## The three that matter most

1. **`updater.install` is now unusable for a real update** — a security fix that deletes the feature. The digest must be taken over the same shape on both sides (digest the downloaded artifact, then verify the extracted bundle against a manifest digest of the bundle), or `download` must be the one that extracts and records the directory digest.
2. **Finding 10 is open again in the working tree** — `URL_CHUNK = 1024` with a 2047 threshold, so the fail-closed check cannot fire. Either raise the read buffer to `NETWORK_URL_LIMIT + 1` or lower the constant to the buffer's real bound; and prove it through the shim, not by calling `decide` directly.
3. **Finding 18 remains the whole model** — the individual holes are closed but one XSS still owns every surface at once. That is the finding the other seventeen were proxies for.

## Scope of this check

- No `src/` edit, no test, no commit. `bun run check:lines` PASS (no file exceeds 200 lines).
- Findings judged reachable-only: finding 9's Linux branch and finding 14's race are both unreachable (no Linux network registration, no `uniquePath`), and are recorded as such rather than as live defects.
