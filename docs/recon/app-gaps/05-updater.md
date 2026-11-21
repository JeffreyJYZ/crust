# Gap 5 — updater: "blocked by keys, not code"

**Verdict: `crust tooling`.** The runtime contract is already complete, correct and documented; what
does not exist is the *publisher* half — a keypair, an updater-shaped zip, and the manifest — so every
app writes the same OpenSSL recipe by hand. The claim "blocked by keys, not code" is two-thirds right
and one-third wrong: there is no feed to own (one JSON document, no server), so the friction is
artefact generation, not hosting. One genuine runtime defect stands between a generated manifest and
a GitHub-hosted one: `download` refuses every redirect, and GitHub release URLs are 302s.

---

## 1. What exists today

### The signature: Ed25519 over the artefact's raw bytes

- The manifest's `signature` is base64 of 64 raw bytes, `pubkey` base64 of 32 raw bytes — no SPKI, no
  PEM — and WebCrypto verifies it with no dependency: `src/plugins/updater-signature.ts:1-2`,
  `:8-9`, `:31-59`.
- What is signed is the **artefact file's bytes**, not a digest: `src/plugins/updater-download.ts:53-59`
  (`adapter.readBytes(file.path)` then `verifyEd25519(...)`). For a zip that is the archive; a `.app`
  tree has no byte sequence, so a tree is explicitly **not expressible** by this contract —
  `site/app/docs/guides/updater/page.mdx:120-131`.
- `sha256` is mandatory on every download, signature or not: `src/plugins/updater-download.ts:37-41`.
- The only key a signature is ever checked against is the config's `updater.pubkey`; a manifest's own
  `pubkey` may only *name* that key, never replace it: `src/plugins/updater-signature.ts:67-84`,
  `src/plugins/updater.ts:100-107`. That is the anti-self-certification rule and it is sound.
- Key shape is validated at startup, by length, so a 31-byte key cannot limp into runtime:
  `src/config/validate-updater.ts:5-22`.
- `install` accepts only a path this run downloaded and verified, then re-hashes it before the swap:
  `src/plugins/updater.ts:113-150`.
- `install`/`relaunch` are macOS-only and refuse by name elsewhere: `src/plugins/updater.ts:114`,
  `:163`; documented at `site/app/docs/guides/updater/page.mdx:100`.

### Where the endpoint comes from

- `updater.endpoint` in `crust.config.ts` is the fallback; the page may pass its own on `check`:
  `src/plugins/updater.ts:76-79`; config type `src/config/types.ts:135-147`.
- Fetched with `fetch`, `accept: application/json`, **`redirect: "manual"`**: `src/plugins/updater-node.ts:57-68`.
- Scheme policy: `https` only, `file:` only with `updater.allowFileUrl`: `src/plugins/updater-url.ts:22-44`.
- **Any 3xx is a refusal**, for the manifest as well as the artefact: `src/plugins/updater-fetch.ts:42-56`,
  wired at `src/plugins/updater-node.ts:62` and `:71`. This was a deliberate fix — "only https" must
  cover the bytes fetched, not just the URL handed in — `docs/agents/updater-fixes.md:38-42`, with a
  test that asserts a 302 answers `follows no redirect`: `docs/agents/updater-fixes.md:54-57`.
- Body cap 512 MB, refused before the disk fills: `src/plugins/updater-fetch.ts:10-40`.
- No auth header of any kind on either request: `src/plugins/updater-node.ts:58-61`, `:70`.

### The manifest: one document, not a feed

`parseManifest` requires `version` + `url`, optionally `notes`, `sha256`, and the
`signature`+`pubkey` pair together: `src/plugins/updater-manifest.ts:17-37`. `check` compares that one
version against the caller's and answers newer/not: `src/plugins/updater.ts:96-109`;
`isNewer` drops a leading `v` and sorts a release above its prereleases: `src/plugins/updater-args.ts:77-108`.

So there is **no multi-version feed, no channel, no server**: one immutable JSON per version, or one
mutable JSON at a stable URL. Both satisfy the parser.

### Is the format documented? Yes, twice, and honestly

- `site/app/docs/guides/updater/page.mdx:26-38` — the manifest object, field by field, plus the
  refusal rules.
- `site/app/docs/guides/release/page.mdx:32-59` — the by-hand recipe: `openssl genpkey -algorithm
  ed25519`, `pkey -pubout -outform DER | tail -c 32 | base64`, `pkeyutl -sign -inkey key.pem -rawin`,
  `shasum -a 256`, then the JSON.
- The release page states the truth plainly: "Nothing in crust writes the manifest `updater.check`
  reads, or signs the artifact" (`:34`), alongside "no `crust release` … no `crust update publish`"
  (`:3`), and `src/cli/release-scaffold.test.ts:50-72` holds the docs to the verifier's byte sizes.
  A `crust init` scaffold ships a release workflow that uploads only a `.dmg`
  (`templates/default/.github/workflows/release.yml:24-30`) — a release download, not an updater
  artefact, as the guide itself says (`:34`).

### What does not exist anywhere

- `rg -n 'keygen|generateKey' src scripts site/app/docs` → only the verifier's `importKey` and the
  guide's `openssl genpkey` shell text; no generator in code.
- `rg -n 'releases/download|api.github' site docs src templates` → nothing ties the updater to GitHub
  Releases; the only `gh release` uses are crust's own publishing
  (`templates/*/.github/workflows/release.yml:28-30`, `scripts/release.ts`).
- No `zip` packaging format: `src/cli/package/format.ts:6` is `dmg | appimage | nsis`.
- No updater section in `crust doctor`: `rg -n 'updater' src/cli/doctor*.ts src/cli/doctor/` → nothing.

---

## 2. What is genuinely the app's to own

Three things, and only three:

1. **A private key, kept out of the repo.** Its custody is a distribution decision; crust must never
   hold, read from a URL, or print one.
2. **A host serving two files** — the JSON and the zip — at URLs that do not move under a client
   that pinned a key. Any static host, R2 bucket, Pages project or release asset qualifies; the
   runtime needs nothing to be running.
3. **The public key pinned in `crust.config.ts`.** `updater.pubkey` is the trust root
   (`src/config/types.ts:138-139`) and is deliberately the *only* accepted signer.

Everything else — key format, signature bytes, digest, extraction, receipt, swap — crust already owns.
The page cannot certify its own update and the app cannot be tricked into installing unverified bytes;
that was the hard half and it is done.

**A correction to the app's own framing.** "signed feed you own" overstates it. `check` reads one
document and compares one version (`src/plugins/updater.ts:96-109`); nothing in the runtime wants a
feed, an index, a channel list or a server. The publishing cost is *artefact generation*, which is
crust's kind of work, not *hosting*, which is the app's.

---

## 3. What crust could ship instead of leaving it as homework

### 3a. Keys and signature with no OpenSSL and no new dependency — measured

Bun's WebCrypto does the whole Ed25519 cycle today, so the `tail -c 32` ritual is avoidable:

```
bun -e 'const s=crypto.subtle; const kp=await s.generateKey({name:"Ed25519"},true,["sign","verify"]);
  console.log((await s.exportKey("raw",kp.publicKey)).byteLength,
              (await s.exportKey("pkcs8",kp.privateKey)).byteLength,
              (await s.sign({name:"Ed25519"},kp.privateKey,new TextEncoder().encode("hi"))).byteLength)'
→ 32 48 64          (Bun 1.4.5, run in this repo, no network)
```

The public half exports as exactly the 32 raw bytes `updater.pubkey` pins, and the signature is
exactly the 64 bytes `verifyEd25519` accepts — the same API the verifier already uses
(`src/plugins/updater-signature.ts:42-55`), so generator and checker cannot drift.

### 3b. `crust manifest` — the one command that closes most of the gap

Shape: `crust manifest <archive.zip> --version 0.2.0 --url <https://…> [--key <path>] [--notes <text>]`.

It would: hash the archive, refuse an input that is not a file (a directory has no bytes to sign —
`site/app/docs/guides/updater/page.mdx:120-131`), sign with the key, and write the manifest JSON that
`parseManifest` accepts (`src/plugins/updater-manifest.ts:17-37`), printing the `updater.pubkey` line
to paste into the config.

New files, all well inside the 200-line cap: `src/cli/manifest.ts` (command body, ~90 lines),
`src/cli/manifest/sign.ts` (key load, sign, keygen; ~80), `src/cli/manifest/write.ts` (manifest object,
url/version checks; ~60), `src/cli/manifest/options.ts` (pure inputs from `CrustConfig.app`, mirroring
`src/cli/package/options.ts:18-68`), plus one test file each.

**Does it fit the CLI's existing shape?** Yes for a *flat* command, with a caveat:

- `COMMANDS` is a flat record of five handlers — `src/cli/commands.ts:13-19` — and help is generated
  from `COMMAND_DESCRIPTIONS` (`src/cli/help.ts:24-30`), so `manifest` is a two-line registration.
- `src/cli/index.ts:59-74` registers every entry and takes `parsed.args[0]` as the command
  (`:90`, `:119`), so the command gets **one** positional — which is exactly the archive path.
- Every new flag costs a line in `KNOWN` and, if it takes a value, in `VALUE_FLAGS`
  (`src/cli/argv.ts:14-27`), because an unlisted option is refused outright (`:61-63`). `--key`,
  `--version`, `--url`, `--notes` = 4 entries plus their `needs a value` coverage.
- `--format`-style validation has a precedent to copy (`src/cli/argv.ts:91-98`).
- `cli-contract` rows (`src/cli/cli-contract-rows.ts:16-172`) and the SKILL.md table
  (`scripts/skill.ts:2-33`, regenerated by `bun run skill`) then follow automatically.

**`crust updater keygen` does not fit as written.** The CLI has no subcommand layer: a non-`init/dev/build`
command may take **zero** positionals (`src/cli/argv.ts:28`, `:74-75`), and `index.ts` reads only
`parsed.args[0]` as the command name (`:90`). `crust updater keygen` would need `updater` added to
`POSITIONAL_COMMANDS` and the second word routed inside `translate` (`src/cli/argv.ts:31-53`) — a
parser change plus a per-subcommand help story, for something that is better as a flag:
`crust manifest <zip> --url … --key ./key.pkcs8`, and `--keygen` (or `crust manifest --keygen`) writing
the pair when the file is absent.

### 3c. A zip of the `.app` — the missing artefact

`crust package` cannot produce the only thing the updater can verify. Formats are `dmg | appimage |
nsis` (`src/cli/package/format.ts:6`) and the scaffold uploads a dmg, which the guide says is "a
release download, not an updater artifact" (`site/app/docs/guides/release/page.mdx:34`). The exact
command already exists inside the notarize plan — `ditto -c -k --keepParent <app> <zip>`
(`src/packaging/notarize-plan.ts:122`) — so `--format zip` is a naming/serde job over an existing
seam, ~50 lines plus its test, and it makes `crust build --dmg --zip` + `crust manifest` a complete
publisher story with no shell scripting at all.

### 3d. `crust doctor` should refuse a config the updater cannot use

No doctor module mentions `updater` (`rg -n 'updater' src/cli/doctor*.ts src/cli/doctor/` → nothing),
yet `validate-updater.ts` already has the exact predicate (`:5-22`) and `fetchUrlFailure` has the
scheme rule (`src/plugins/updater-url.ts:22-44`). Two lines of output — "updater.pubkey 32 bytes",
"updater.endpoint https" — turn the commonest configuration mistake into one line instead of a
`signature-mismatch` after a 60 MB download.

---

## 4. A GitHub Releases feed, and what breaks for private repos

### The manifest a generator would emit

With a `<Name>-<version>.zip` uploaded by the tag workflow, the manifest is:

```json
{
  "version": "0.2.0",
  "url": "https://github.com/<owner>/<repo>/releases/download/v0.2.0/MyApp-0.2.0.zip",
  "notes": "…",
  "sha256": "<64 hex>",
  "signature": "<base64 64 bytes>",
  "pubkey": "<base64 32 bytes>"
}
```

uploaded as a release asset beside the zip, so `check` reads
`https://github.com/<owner>/<repo>/releases/latest/download/manifest.json`. That `latest/download/<asset>`
alias is a stable endpoint that always names the newest non-prerelease asset, which is why a GitHub
feed needs no per-version URL logic in the app at all.

**Both URLs 302.** GitHub answers a release-asset request with a cross-host redirect to a signed
`release-assets.githubusercontent.com` URL (documented GitHub behaviour; not measured in this lane,
which forbids network). crust refuses every 3xx on both paths —
`src/plugins/updater-fetch.ts:42-56`, `src/plugins/updater-node.ts:62`, `:71` — so **a GitHub Releases
feed fails today for the manifest and for the zip**, with `download-failed: … answered a redirect to
…, and download follows no redirect`. This is the sharpest finding of this lane: the GitHub story is
gated on one runtime change, not on anything the app can supply.

The small honest fix is in `updater-fetch.ts`: follow at most 2-3 hops, re-validate the scheme of
every `Location`, refuse any hop that is not `https:`, and refuse an unreadable `Location`. The
existing refusal's own stated purpose — "only https covers the bytes actually fetched"
(`docs/agents/updater-fixes.md:38-42`) — is *satisfied* by an https→https hop, so this is a narrowing
of the rule to what it was for, not a weakening of it. Cost: rewrite `redirectFailure` into a
hop-following fetch used by both callers, and reopen the assertions in
`docs/agents/updater-fixes.md:54-57` and `src/plugins/updater-fetch.test.ts` with the new reason
(reason required, or the next lane reads the change as a regression).

**A doc tension to settle at the same time.** The release guide says "Host one immutable JSON per
version at a stable URL; a URL that serves a new manifest under an old version breaks clients that
already pinned the old key" (`site/app/docs/guides/release/page.mdx:70`). The parser has no
immutability requirement (`src/plugins/updater-manifest.ts:9-39`) and a moving `latest` URL is fine —
the only thing that breaks pinned clients is a **changed `pubkey`**, which `updater.ts:100-107`
refuses. So the guide is stricter than the contract and would push every app away from the one shape
GitHub makes easy. It should say "one JSON whose `pubkey` never changes", not "one JSON per version".

### Private repos: no, and crust should say so instead of adding a token

- The updater sends no `Authorization` header at all (`src/plugins/updater-node.ts:58-61`, `:70`), and
  there is no config key for one (`src/config/validate-updater.ts:3` — `endpoint`, `pubkey`,
  `autoCheck`, `allowFileUrl`, and `v.only` refuses anything else at `:16`).
- Even with a header, a private asset still 302s to a **time-limited signed URL**, so a manifest that
  pinned one would be dead within minutes and a manifest that resolves it would need the API — a
  second network dependency the plugin deliberately does not have.
- A token inside an app binary is extractable from every install, which makes "private" a licence
  check, not a security boundary.

The honest answer for private distribution is the one already in the contract: a static host at an
unguessable path plus the pinned key. Authenticity comes from the signature
(`src/plugins/updater-signature.ts:30-59`), never from URL secrecy, and crust should document that
sentence rather than grow an `updater.token`.

---

## 5. What breaks

1. **Signing a directory.** A generator that hashes a `.app` tree produces a manifest that can never
   verify, because WebCrypto needs bytes and a tree has none
   (`site/app/docs/guides/updater/page.mdx:120-131`). The command must refuse a non-file input by
   name. Getting this wrong looks exactly like a crust bug and would be the single worst outcome.
2. **Private-key handling.** A default output path in the project directory invites `git add` of a
   signing key. The default must be outside the repo (e.g. `~/.config/crust/keys/<app.id>.pkcs8`,
   mode `0600`), the key must never be printed, and the command must refuse to overwrite an existing
   key silently.
3. **The `pubkey` a generator prints must be pinned by the human.** Nothing auto-edits
   `crust.config.ts`; a tool that rewrote the trust root would turn a signing helper into a
   trust-root mutator.
4. **The 200-line cap.** `crust manifest` touches `commands.ts`, `help.ts`, `argv.ts`, `index.ts` plus
   four new files — no file near the cap, but `src/cli/argv.ts` gains four `KNOWN` entries and
   `cli-contract-rows.ts` gains rows, and both files are already the biggest in `src/cli/`.
5. **Parser shape.** Adding a second word to the command grammar (if `crust updater keygen` is
   insisted on) turns a flat vocabulary into a tree, and every contract row that asserts
   `crust <verb>` is unknown (`src/cli/cli-contract-rows.ts:118-124`) starts depending on how the
   tree is matched. Flat command, flag for keygen: no such risk.
6. **Redirects.** Changing `redirectFailure` contradicts a shipped fix and its test
   (`docs/agents/updater-fixes.md:38-42`, `:54-57`). It is safe only if every hop is checked; a
   `redirect: "follow"` shortcut would silently reintroduce the cleartext downgrade the fix removed.
7. **Scope creep into signing identity.** Apple code signing and notarization are already excluded on
   purpose (`site/app/docs/guides/release/page.mdx:20`). The manifest is the *updater's* signature,
   which is a different key; the tool must not hint that it replaces `--sign`/`--notarize`.

---

## 6. Estimate

**S** for the core: `crust manifest <zip> --version --url [--key]` plus `--keygen`, using WebCrypto
(measured above), reusing `parseManifest`'s shape and `readBytes`-style hashing. Two commands' worth of
surface, no network, no new dependency, no platform code, and its own test can call `verifyEd25519`
directly (`src/plugins/updater-signature.ts:31-59`) to prove the emitted manifest verifies — a
round-trip that no existing test in the repo performs end to end.

**M** if it lands with `crust package --format zip`, the bounded https→https redirect fix, the
`crust doctor` updater line, the guide rewrite (GitHub Releases recipe replacing the OpenSSL one), and
scaffold-workflow changes — i.e. if GitHub Releases is the target. The redirect change alone is small
code with a large contract cost: it reopens a recorded security fix, so it needs its reason written
down and its test rewritten, not just edited.

**The recommendation is the S first, the redirect fix second, in that order** — the manifest tool is
useful on any static host today, and the redirect fix is only needed once someone insists on GitHub.

---

## 7. Largest risk

**A generated manifest that cannot verify is indistinguishable from a broken updater.** The contract's
one asymmetry — bytes can be signed, trees cannot
(`site/app/docs/guides/updater/page.mdx:120-131`) — is exactly the step a publisher gets wrong by
hand today, and it is the step a tool is most tempting to "just handle". A tool that quietly digests a
directory, or produces a `signature` over a digest instead of over the bytes
(`src/plugins/updater-download.ts:53-59`), would ship a manifest whose failures surface as
`signature-mismatch` on a user's machine. So the tool's first obligation is refusing: not a file, not
a zip, refuse by name.

Second, and close: **publishing the GitHub route before the redirect fix.** A generated manifest
pointing at `github.com/.../releases/download/...` is correct by every other measure and still fails
with `follows no redirect` (`src/plugins/updater-fetch.ts:46-56`), which reads as an updater defect
rather than a URL choice.

---

## 8. What stays the app's job

- The private key, its custody, and its backup. crust generates and uses it, never stores it in the
  repo, never transmits it.
- The host, the bucket, the CDN, and the URL. crust writes the URL into the manifest; whether it is a
  Pages project, R2, an S3 bucket or a release asset is a distribution decision.
- The decision to rotate keys — which invalidates every pinned client and is therefore a release
  event, not a config edit.
- Whether the update is shown, deferred, or forced. `check` answers available/not and the app decides
  (`src/config/types.ts:140-144`: `autoCheck` is echoed, nothing is started on crust's behalf).
- Private distribution. Path secrecy is a UX choice; real authenticity is the pinned key, and crust
  should say so rather than add a token.

---

## Appendix — searches that prove the absences above

| claim | search |
| --- | --- |
| no key generator in code | `rg -n 'keygen\|generateKey' src scripts site/app/docs` → only `importKey` in `updater-signature.ts`, `openssl genpkey` in the release guide |
| no GitHub feed wiring | `rg -n 'releases/download\|api.github' site docs src templates` → only crust's own `gh release create` |
| no zip artefact | `src/cli/package/format.ts:6` → `["dmg","appimage","nsis"]` |
| no updater doctor check | `rg -n 'updater' src/cli/doctor*.ts src/cli/doctor/` → no match |
| no auth on either request | `src/plugins/updater-node.ts:58-61`, `:70` |
| redirects refused | `src/plugins/updater-fetch.ts:46-56`; asserted in `docs/agents/updater-fixes.md:54-57` |
