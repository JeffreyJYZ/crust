# State that outlives its owner — `src/plugins/window*`

Read-only hunt. Scope: every source file matching `src/plugins/window*` (21 files) plus the two
shared seams they reach (`store-file.ts` for the lock, `bridge/window-identity.ts` for the token)
read for context only. All 18 `window*` suites pass (84 tests), so every finding below is a
behaviour the current tests do not pin.

**Count: 5 findings** (1 medium, 4 low).

**Worst: F1 — `restore`/`restoreAll` read the state file outside the lock that every writer uses, so a forgotten or superseded frame can be applied after the command that retired it.**

---

## F1 (medium, worst) — reads bypass the state lock; a stale frame outlives the `forget` that removed it

- `src/plugins/window-persist.ts:161-169` — `restore` calls `readState(file)` directly at `:164`;
  its sibling `save` (`:153`) and `forget` (`:174`) both wrap their read-modify-write in
  `withStateLock(file, …)`.
- `src/plugins/window-persist-all.ts:87-103` — `restoreAll` likewise reads at `:90` with no `lock`,
  while `saveAll` (`:68`) and `forgetAll` (`:108`) take the seam's lock.
- `src/plugins/window-persist-store.ts:73-80` — `withStateLock`'s own contract says it exists so
  "concurrent commands see each other's commits"; the two commands that *consume* commits are the
  ones that do not use it.

**Reached:** a page calls `window-state.restore({label:"main"})` and
`window-state.forget({label:"main"})` in the same handler (`Promise.all`, or just back-to-back
without awaiting). `restore`'s `readFile` is in flight when `forget` acquires the lock, re-reads the
file, deletes the entry and commits the empty state. `restore`'s continuation then resumes with the
**pre-forget** frame and calls `frames.apply(label, frame)` — the window is moved to a frame whose
persisted state the caller just deleted. The file no longer holds it, so a later `restore` correctly
reports `restored:false`, which makes the live window's stale position look unexplained. Same shape
with `saveAll` instead of `forget`: `restore` can apply the generation that `saveAll` replaced.
No cross-process timing is needed; it is two commands in one JS event loop.

---

## F2 (low) — `writeState` creates the state file world-readable

- `src/plugins/window-persist-store.ts:90-95` — `writeFile(temporary, …)` has no `mode` option.
- `src/plugins/store-file.ts:83-93` — the sibling `writeStore` passes `{ mode: 0o600 }` on the same
  rename-into-place pattern, with a comment calling out that the temp file carries the mode.

**Reached:** the first `save` (or `saveAll`) creates
`~/Library/Application Support/<app>/window-state.json`. Measured on this machine with the default
umask: `stat` mode `644`. Every saved window position and size for every app is readable by any
local user, while the store file next to it is `600`. The window-state file inherits none of the
privacy treatment the store deliberately gives its temp file, and every later `rename` preserves
the loose mode.

---

## F3 (low) — the seed token copied into a created window's URL outlives the bridge that issued it

- `src/plugins/window-create.ts:60` — `const token = currentBridgeToken();`
- `src/plugins/window-create.ts:66-71` — the token is appended to the document URL for every
  crust-composed create, and `create.call(native, options)` at `:79` hands that URL to the platform.
- `src/bridge/window-identity.ts:71-80` — the bridge clears/replaces the process-wide token on
  stop/restart; `src/runtime.ts:134-136` does exactly that.

**Reached:** the app creates a child window (URL `/child?window=child&token=T1`), then the bridge is
stopped and restarted in the same process — `T2` is now current. The child window's address bar
still holds `T1`. When that page reloads, the document route is presented a credential for a bridge
that no longer exists; after the token ledger evicts it (256 tokens,
`src/bridge/server/document-tokens.ts:11,27-30`) the reload answers `401`. The credential baked
into the window URL is state whose owner (the bridge session) is gone, and nothing rewrites it.

---

## F4 (low) — `restoreAll` has no per-window isolation; one window's refused apply aborts the rest

- `src/plugins/window-persist-all.ts:99` — `frames.apply(label, frame)` runs with no `try/catch`,
  and `act` at `:55-59` converts the first throw into one `WindowFailure`.
- `src/plugins/window-persist-all.ts:71-78` — `saveAll` deliberately isolates each label in the same
  loop, with the stated reason "aborting would lose the frames that are fine".

**Reached:** `adapter.list()` returns `[main, ghost]`, the state file has frames for both, and
`setSize`/`setPosition` for `ghost` throws (a window on a now-disconnected monitor, or any adapter
write failure). `restoreAll` applies `main`, then throws on `ghost`; the caller gets a single failure
with no label and cannot tell which window failed, and any labels after `ghost` in `list()` are
never restored even though their frames were valid. The bulk command's "name every window it could
not restore" promise (`:2`, `missing`) only covers *absent* frames, not failed applies.

---

## F5 (low) — `restore` demands all four frame members although it only writes

- `src/plugins/window-persist.ts:119-126` — `frames(native)` requires `getSize`, `getPosition`,
  `setSize` **and** `setPosition` before any command runs.
- `src/plugins/window-persist.ts:163` — `restore` calls `frames(native)` although it only uses
  `apply` (`:140-143`, the two setters); `restoreAll` does the same through the injected `calls`
  at `window-persist-all.ts:89`.

**Reached:** pass a real partial adapter — `{ list, setSize, setPosition }` — for a platform that
can position windows but cannot read their frames, then call `window-state.restore({label:"main"})`.
The command answers `unknown-adapter` and restores nothing, even though the saved frame is present
and both members it needs exist. Verified by probing with that adapter: the refusal names the
two getters it never calls. `save` needs the getters; `restore` does not, but the single gate makes
them a package deal.

---

## Coverage

Read in full: `window.ts`, `window-types.ts`, `window-args.ts`, `window-state.ts`,
`window-state-args.ts`, `window-state-types.ts`, `window-state-toggles.ts`, `window-chrome.ts`,
`window-chrome-types.ts`, `window-capture.ts`, `window-capture-types.ts`, `window-create.ts`,
`window-label.ts`, `window-persist.ts`, `window-persist-store.ts`, `window-persist-all.ts`,
`window-persist-fake.ts`, `window-fake.ts`, and all 18 `*.test.ts` files. Context only (not counted
as findings): `src/plugins/store-file.ts`, `src/bridge/window-identity.ts`,
`src/runtime.ts`. No source was changed; only this report was written.
