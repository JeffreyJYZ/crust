# 16 — updater family

Area: `src/plugins/updater*.ts` (archive, artifact, args, bundle, download, manifest, node, receipt, signature, slip, url, zip-fixture, fake) and their tests. Report path `docs/reviews/defects-wave3/16-updater.md`.

## Findings

### 1. `digestTree` records only a basename per level, so two different bundles can share one tree digest — MEDIUM
`src/plugins/updater-node.ts:32`
`digestTree` is called as `digestTree(hash, join(path, entry), entry)`: the name it hashes is the entry's basename, never its path relative to the bundle root. Directories go in as `d <basename>`, files as `f <basename>`, and nothing else in the stream says which directory a file sat in. So `X/a.txt` and `Y/a.txt` hash the same, and so do `p/q/r.txt` and `p/q2/r.txt` whenever the sibling directories are empty. The receipt guarantee — "a verified artifact that changed afterwards is refused" — rests entirely on this digest.
**Breaks:** a tree edited after `download` can be rearranged between directories without moving the digest, so `install` accepts it and renames it over the running app. The suite only ever digests `Contents/marker.txt`, one level deep, so nothing catches it.
**Evidence:** `for (const entry of (await readdir(path)).sort()) { await digestTree(hash, join(path, entry), entry); }`

### 2. The zip reader bounds-checks nothing: a malformed central directory throws a raw `RangeError`, not `invalid-archive` — MEDIUM
`src/plugins/updater-archive.ts:93`
`readCentral` trusts the central-directory `nameLength` (+28), `extraLength` (+30), `commentLength` (+32) and the local header's `nameLength`/`extraLength` (`dataOf`, 82-84) with no comparison against `view.byteLength`. `findEnd` (56) is a blind backward `getUint32` scan, and `readArchive` (130) advances `at` by those attacker-controlled lengths for `count` rounds. Every read is a `DataView` access, so a truncated or hostile archive raises `RangeError: Offset is outside the bounds of the DataView` — not `ArchiveError`. The adapter does wrap it, but with the engine's message, while `extractZip`'s contract (`updater-types.ts:96`) promises `invalid-archive` and `updater-archive.ts:5` promises every refusal names the entry. Neither holds here.
**Breaks:** a truncated download — an ordinary failure — surfaces an engine offset error instead of `invalid-archive`, and the author gets no entry name.
**Evidence:** `const nameLength = view.getUint16(at + 28, true);` — no `at + 46 + nameLength <= view.byteLength` anywhere.

### 3. `config/types.ts` promises `autoCheck` is a startup check; nothing ever reads it — LOW
`src/config/types.ts:84`
`/** Whether the app wants a check at startup; updater.config reports it. */` — `rg autoCheck src` returns only the config type, the validator's type test, `runtime-plugins.ts` passing the section through, and `updater.ts:65` echoing it into `updater.config`. No code path performs a check. The guide (`site/app/docs/guides/updater/page.mdx:14`) only claims `config` reports it, so the docs are right and this comment is the defect.
**Breaks:** an author sets `autoCheck: true` and the app never checks for an update; it ships silently out of date.
**Evidence:** `/** Whether the app wants a check at startup; `updater.config` reports it. */`

### 4. `linkedPath` is exported, never called, and its rationale is the opposite of what `install` does — LOW
`src/plugins/updater-bundle.ts:52`
It refuses a symlinked `appPath` — "a rename over a link would leave the app in place" — yet `install` never calls it, and `replaceBundle` (`updater-node.ts:127`) deliberately `realpath`s the target and renames the resolved bundle, with `updater-install-target.test.ts:63` asserting a symlink to the own bundle installs successfully. So the tree ships two contradictory contracts for one case, and the exported one is the refusal the plugin does not make.
**Breaks:** nothing at runtime; a caller who imports the helper gets a refusal `install` itself would not issue.
**Evidence:** `export async function linkedPath(appPath: string): Promise<UpdaterFailure | undefined> {` — one match tree-wide, its own definition.

### 5. `download` never bounds the response body, and the manifest has no `size` field — LOW
`src/plugins/updater-node.ts:54`
`await Bun.write(path, response)` with no `Content-Length` check and no cap; `UpdateManifest` (`updater-args.ts:36`) has no size field to check against. A 200 with an endless body fills the temp dir before anything hashes it. The sha256 still gates what is *installed*, so this is exhaustion, not code execution.
**Breaks:** a wrong or hostile artifact URL fills the disk; the run dies on out-of-space long before the digest check.
**Evidence:** `await Bun.write(path, response);`

### 6. `fetch` follows redirects, so "only https" holds for the URL passed and not for the bytes fetched — LOW
`src/plugins/updater-node.ts:55`
Neither `fetchJson` nor `download` passes `redirect`, and Bun's default is `follow`. A `https:` URL answering 302 to `http://…` is fetched in cleartext — the exact scheme `updater-url.ts` refuses at the door. Content stays pinned by the digest, so this is the policy claim ("`download` fetches `https` only", `updater-download.ts:3`, `updater-url.ts:1-5`), not integrity.
**Breaks:** an app that believes it never speaks cleartext does, with nothing in the run saying so.
**Evidence:** `const response = await fetch(url);`

## Coverage
Read in full: `updater.ts`, `updater-args.ts`, `updater-types.ts`, `updater-manifest.ts`, `updater-download.ts`, `updater-artifact.ts`, `updater-archive.ts`, `updater-slip.ts`, `updater-signature.ts`, `updater-bundle.ts`, `updater-node.ts`, `updater-receipt.ts`, `updater-url.ts`, `updater-zip-fixture.ts`, `updater-fake.ts`, and all nine updater test files (`updater`, `updater-args`, `updater-download`, `updater-archive`, `updater-install`, `updater-archive-install`, `updater-install-target`, `updater-own-bundle`, `updater-relaunch`). Also `src/config/validate-updater.ts` and its test, `src/config/validator.ts`, `src/runtime-plugins.ts`, `src/runtime.ts`, and the docs `site/app/docs/guides/updater/page.mdx` + `reference/api-updater/page.mdx`.

Checked and sound, so not reported: `compareVersions` is numeric per segment — `0.1.9` < `0.1.10`, `v` prefix dropped, missing segment is zero, any tag sorts below its release (`updater-args.ts:77-107`, tested in `updater-args.test.ts`); `assertEntryName` refuses empty, NUL, backslash, absolute, drive-letter and every `..` segment; `assertLinkInside` resolves against the root and refuses absolute or escaping targets; `archiveRoot` demands exactly one top-level `.app`. `verifyEd25519` is only ever called with the config's pinned key — `readSignatureArgs` returns `null` for a foreign `pubkey` and `requiresPubkey` refuses a signature with no pin (`updater-signature.ts:74-92`, tested at `updater-download.test.ts:83-115`). `install` re-hashes both the tree and, for an archive, the zip before the swap, and `replaceBundle` puts the old bundle back if the second `rename` throws.

Not verified by a run: finding 2 is reasoned from source — the fixture writer (`updater-zip-fixture.ts`) can only emit well-formed headers, so no existing test can produce a truncated central directory, and the brief's one-test allowance would not decide it. Findings 1, 5 and 6 are also source-read; 1 and 6 have no test that could fail today (nothing digests a nested tree, nothing points `download` at a redirecting URL).