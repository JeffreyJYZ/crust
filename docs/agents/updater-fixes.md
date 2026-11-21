# updater lane — fix wave 3

Report `docs/reviews/defects-wave3/16-updater.md`, findings 1, 2, 4, 5, 6. Finding 3 is
`src/config/types.ts`'s `autoCheck` comment, which belongs to the `config` lane; not touched here.

## What changed

**1. `digestTree` hashed a basename per level (MEDIUM)** — `src/plugins/updater-node.ts:32`.
The recursive call now passes the path *relative to the bundle root* (`name === "" ? entry :
`${name}/${entry}``) instead of the bare entry name, so `X/a.txt` and `Y/a.txt` digest differently and
so do `p/q/r.txt` and `p/q2/r.txt`. The digest format is otherwise unchanged (`d <rel>` / `f <rel>` +
bytes). This changes every directory digest, which is only ever compared against another digest this
adapter produced in the same run, so no stored value goes stale.

**2. The zip reader bounds-checked nothing (MEDIUM)** — `src/plugins/updater-archive.ts`.
New `assertRange(view, at, length, what)` throws `ArchiveError` with the observed byte length, and it
runs before every `DataView` read whose offset comes from the archive: the central directory header
(46 bytes), the entry name plus extra plus comment block, the local header (30 bytes), the entry data,
and the end-of-central-directory record. `readArchive` also refuses a central-directory offset past
the bytes on hand. A truncated or hostile archive now answers `invalid-archive` carrying the archive's
own path, never `RangeError: Offset is outside the bounds of the DataView`. `findEnd` is unchanged on
purpose: bytes shorter than an end record still answer `is not a zip archive`, which is the message the
existing test pins and the more accurate one.

**4. `linkedPath` was exported, uncalled, and contradicted `install` (LOW)** — deleted from
`src/plugins/updater-bundle.ts`. `install` deliberately accepts a symlink to this app's own bundle
(`replaceBundle` realpaths the target and renames the resolved bundle, asserted by
`updater-install-target.test.ts:63`), so the helper was a second, contradictory contract. The
`lstat` import went with it. Nothing else imported it (`rg linkedPath src` is empty).

**5. `download` never bounded the body (LOW)** — new `src/plugins/updater-fetch.ts`.
`MAX_DOWNLOAD_BYTES` (512 MB) plus `readBounded`, which refuses a declared `content-length` over the
cap before reading and stops mid-stream when the running total passes it. `download` now reads the
response in chunks and `writeFile`s the bounded bytes instead of `Bun.write(path, response)`, so the
returned `bytes` is the count actually written. Refusal code is `download-failed`, naming the URL and
the cap.

**6. `fetch` refused redirects (LOW, superseded 2026-11-21)** — same file. `fetchJson` and `download`
passed `redirect: "manual"` and turned any 3xx into a `download-failed` naming the location. That made
`https://github.com/…/releases/latest/download/…` unusable, because GitHub answers 302, and the guide
presented GitHub Releases as the normal host. `fetchFollowing` in `updater-fetch.ts` now follows at most
five `https`→`https` hops, re-checks every `location` and refuses any `http:` target before requesting
it. The security boundary is the pinned Ed25519 `updater.pubkey` over the artefact bytes, never the
hostname, so a redirect that changes host does not widen what can be installed.

## Tests added

- `src/plugins/updater-node.test.ts` — a file moved to a sibling directory digests differently;
  `p/q/r.txt` vs `p/q2/r.txt` differ; a name at two different depths (`a/b.txt` + `c.txt` vs
  `a/b.txt` + `a/c.txt`) differs, which is the exact collision the old stream produced; `install`
  refuses a verified tree whose file moved between directories; and the bundle module no longer
  exports `linkedPath`, so the surviving symlink contract is `install`'s.
- `src/plugins/updater-archive.test.ts` — three `finding 2` cases: a truncated archive, a central
  directory whose `nameLength` is 0xffff with no bytes behind it, and a real `download` of a truncated
  zip answering `invalid-archive` with the archive named and no engine offset text.
- `src/plugins/updater-fetch.test.ts` — a real `Bun.serve` on loopback: a 302 to an https object is
  followed and the object's body is what arrives; a 302 to `http:` is refused before the plaintext
  request is made (one request, not two); a redirect loop stops at the five-hop bound; a 200 still
  parses; a declared `content-length` over a 16-byte cap refuses before reading; a chunked body with no
  header is stopped mid-stream; the default cap is the number reported.

`bun test src/plugins/updater` — 62 pass, 0 fail. `bun check` reports nothing under `src/plugins`.
`bun fmt` applied to the seven touched files only. `bun run check:lines` fails on
`src/packaging/extension-compile.test.ts` (265) and `src/runtime-plugins.ts` (202), neither mine; every
updater file stays at or under 200 (`updater-node.ts` 171, `updater-archive.ts` 169,
`updater-fetch.ts` 56, `updater-bundle.ts` 66).

## Traps recorded

- A tree digest that names only basenames is not a tree digest. Measured: under the old stream
  `{a/b.txt, c.txt}` and `{a/b.txt, a/c.txt}` hashed identically (`d a`, `f b.txt`, `f c.txt` both
  times), so depth itself was invisible — not just which sibling directory held a file. `install`
  re-compares that value, so the receipt guarantee was decorative for any nested tree. The old suite
  only ever digested one level, which is why nothing caught it.
- Two flat roots holding one identically named file (`X/a.txt` vs `Y/a.txt`) still hash the same on
  purpose: the root's own name is not part of the stream, and `install` replaces a bundle by path, so
  the root name carries no meaning.
- Every zip offset is attacker-controlled. `DataView` reads throw `RangeError`, not `ArchiveError`, so
  a bounds check must come before the read and must name the archive; `readArchive`'s contract says
  `invalid-archive`, and an adapter that re-wraps the engine message still leaks "Offset is outside
  the bounds of the DataView" to the author.
- `fetch(..., { redirect: "manual" })` returns the 3xx itself in Bun (status 302, `type: "default"`,
  `location` header readable) rather than an opaque redirect; checking both `status >= 300 && < 400`
  and `type === "opaqueredirect"` covers either runtime. `redirect: "error"` also refuses but throws a
  `TypeError` naming neither the URL nor the location. A hop is only safe because the signature names the
  bytes: `https://github.com/…/releases/latest/download/…` answers 302 and must be followed for GitHub
  Releases to work at all (2026-11-21).
- `Bun.write(path, response)` consumes the whole body with no cap. Reading `response.body` in a
  `for await` and accumulating gives the byte count as it grows, so the refusal lands before the disk
  does.
- The house cap on files is real: `updater-fetch.ts` exists because the bounds belong to a seam of
  their own, not because `updater-node.ts` needed splitting for taste.
