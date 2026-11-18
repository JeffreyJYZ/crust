# Lane C4 — updater end to end

Read: `src/plugins/updater*.ts`, `site/app/docs/guides/updater/page.mdx`, and the publisher recipe in
`site/app/docs/guides/release/page.mdx` (§Publish an update).

## Probe

`docs/reviews/next-wave/probes/updater-end-to-end.ts` (+ `updater-e2e-support.ts`, split out to keep
both under the 200-line cap: 167 and 113 lines). Run:

```
bun docs/reviews/next-wave/probes/updater-end-to-end.ts
```

Result `RESULT  PASS`, 17 PASS lines. Every stage ran on real bytes and real Ed25519, not mocks:

- A fake v2 is published as a **real zip** (`bundleZip`) with the documented manifest fields
  (`version`, `url`, `notes`, `sha256`, `signature`, `pubkey`); key/signature from WebCrypto.
- `updater.config` pins the key; `check` finds v2 and passes the manifest through.
- `download` computes sha256, verifies the Ed25519 signature with the pinned key, and extracts the
  zip via the **real** node adapter — proving the author-ships-a-signed-archive contract.
- `install` runs all its gates (receipt, own-bundle, both re-hashes) and reaches the swap seam with
  exactly `(verified source, own bundle, <app>.old)`; `relaunch: true` records the launch of the own
  bundle.
- The release guide's **openssl recipe** (genpkey → raw 32-byte pubkey → pkeyutl rawin signature)
  was run for real and verified with crust's own `verifyEd25519`.
- Red case: a signature over tampered bytes is refused `signature-mismatch`, no receipt is recorded,
  `install` on that path answers `unverified-artifact`, and nothing is staged or launched.

## Where it stopped, and why

Stopped at `adapter.replaceBundle(source, appPath, backup)` in `install`. The recording adapter
captures the operands but does not rename. That call is the destructive swap of a running `.app`:
it is irreversible on this machine and is precisely the step the brief says not to take. Everything
before it — check, hash, signature, extraction, receipt, re-hash, own-bundle gate — executed for real.

## Findings

- **No defect found in `src/plugins/updater*.ts`.** No source file was changed: the chain, the
  pinned-key policy, the two-digest archive receipt, and the bad-signature refusal all behaved as
  documented.
- **Not drivable headlessly:** `replaceBundle` (a real rename over a live bundle) and `relaunch`
  (`open -n`) need an actual signed `.app` on macOS and a GUI session with a running process. The
  probe proves the operands and the launch call at the seam; it cannot prove the rename or a new
  process starting. Those remain unproven without a real signed app and a person at the Mac.
- `check` does not verify the signature (by design); verification happens at `download`. The red
  case asserts both halves explicitly so this is a stated contract, not an oversight.
