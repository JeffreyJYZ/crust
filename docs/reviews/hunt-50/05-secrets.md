# `src/plugins/keychain*` + `src/plugins/stronghold*` hunt — 05 (secrets that outlive the process)

Scope: every `keychain-*` and `stronghold-*` file under `src/plugins/`, plus the call sites that decide
where a stored secret lands and the FFI shims those plugins drive. Read-only source inspection via
`rg`/`fd`/`read`; no app launched, no cursor moved, no test run. All claims are `read`.

## HIGH — every crust app shares one `stronghold.json`, so secrets persist at a fixed machine-wide path

- where: `src/plugins/stronghold.ts:54` (`options.root ?? defaultStoreRoot(options.app ?? "crust")`),
  `:190` (the exported default `createStrongholdPlugin()` with no options);
  `src/plugins/stronghold-file.ts:37` (`STORE_FILE = "stronghold.json"`), `:41-45` (`defaultStoreRoot`);
  `src/plugins/core.ts:38-46` (line 45: `strongholdPlugin` in `ALWAYS`);
  `src/runtime-plugins.ts:40-42` (`appRoot` from the configured app id), `:67-69` (`store` and
  `database` rebuilt with `{ root: appRoot }`), `:157-169` (core plugins pass through unchanged, so
  stronghold never receives `appRoot`).
- mechanism: `store`, `database`, `window-state` and crash records all get the app-specific root;
  stronghold is the one file-holding core plugin the runtime leaves at its hardcoded default. The file
  is thus always `~/Library/Application Support/crust/stronghold.json` (or `CRUST_DATA_DIR`), regardless
  of `app.id`. Contents are sealed, but the whole vault — every key name HMAC and sealed value — survives
  app A's process in one shared file that every other crust app opens by default. `open` accepts any
  password and proves it against the header marker (`stronghold-crypto.ts:137-140`), so any local crust
  app gets an offline password-checking oracle over app A's vault, and once a password is shared one
  app's `get` reads another's secrets. The docs promise "the app's data directory"
  (`site/app/docs/reference/api-fs/page.mdx:75`), which the code does not do.
- reachable by: two installed crust apps with different `app.id`s; no special config. App A does
  `invoke("stronghold","open",{password})` + `set({key:"token",value:secret})`. App B does
  `invoke("stronghold","open",{passwordGuess})` and reads the answer `ok` / `bad-password`; with the
  password, `get` returns A's secret. A and B also contend for the same file on concurrent `set`
  (`stronghold.ts:98-125` serializes only within one plugin instance, not across processes).
- smallest fix: build stronghold with the app root the way `store`/`database` are — inject
  `createStrongholdPlugin({ root: appRoot })` in `runtime-plugins.ts` (both arms) and replace the
  `strongholdPlugin` entry in `core.ts`, so the default path is per app. Keep the bare export for
  direct users but document that it is a machine-wide fallback.

## HIGH — `open` is outside the write queue and unconditionally overwrites `session`; an explicit `close` can be silently undone

- where: `src/plugins/stronghold.ts:70-91` (the whole `open` handler; `:84-87` the store read/KDF awaits,
  `:86` `session = opened.store`), against `:59-65` (`serial`) and `:120`/`:161` (the `if (session ===
  active)` guard that `set` and `delete` use for exactly this race).
- mechanism: `set` and `delete` are serialized and refuse to clobber a `close` that landed during their
  await; `open` is neither serialized nor guarded. `open` awaits `readStore`, `createStore`/`openStore`
  (PBKDF2 at 600 000 rounds, `stronghold-file.ts:19`, plus disk I/O — tens of milliseconds). A `close`
  in that window returns `{ ok: true, closed: true }` and sets `session = undefined` (`:93-96`), but the
  pending `open` then assigns `session` unconditionally at `:86`. The vault is unlocked again although
  the page was told it was locked. Two overlapping `open` calls with different passwords are decided by
  whichever derivation finishes last, not by call order.
- reachable by: `const p = invoke("stronghold","open",{password:"pw"}); invoke("stronghold","close");
  await p; invoke("stronghold","get",{key:"token"})` — `get` answers with the secret after the explicit
  lock. Reachable without malice too: a lock-on-unmount or lock-on-background button clicked while a
  first open is still deriving keys.
- smallest fix: route `open` through the same `serial` queue and capture the session identity before
  the awaits, assigning only when it is still current (the `:120` shape); have `close` bump a generation
  counter that `open` checks.

## LOW — the FFI shims keep the secret from `keychain.set` strongly referenced for the rest of the process

- where: `src/plugins/keychain.ts:133` hands the secret to the adapter; the retention is in
  `src/platform/darwin/keychain-ffi.ts:120` (`let pinned: Uint8Array[] = []`), `:123-127` (`bytesOf`
  pushes every encoded buffer), `:134-149` (`set` resets `pinned`, encodes the secret into `v`, and
  returns without releasing it). Same shape in `src/platform/windows/keychain-ffi.ts:116`, `:118-122`,
  `:129-143`.
- mechanism: the comment at `darwin/keychain-ffi.ts:118-119` says the reference is "for the duration of
  one call", but `pinned` is cleared only at the *start* of the next call. After a `set` returns, the
  `Uint8Array` holding the secret bytes stays reachable from module scope until another keychain call
  or process exit. A heap/core dump, swap write or local process-memory read after the write therefore
  still contains the secret; the intended post-call release never happens. `get` leaves only names
  pinned, so this is specific to writes.
- reachable by: one `invoke("keychain","set",{service,account,secret})` followed by no further keychain
  calls — the common "store a token once" flow. The bytes persist for the entire app lifetime.
- smallest fix: clear `pinned` in a `finally` at the end of each shim method (or drop the array and pin
  each buffer locally until the FFI call returns), and overwrite the secret buffer with zeros on the way
  out where the runtime allows it.

## LOW — caller-supplied key names are echoed into stronghold failure messages, which can be persisted by page logging

- where: `src/plugins/stronghold.ts:134` (`no entry for ${key}`), `:137` (`the value for ${key} does not
  decrypt`); the parallel adapter errors are also passed through by `reasonOf(error)` at `:123`, `:141`,
  `:164`, `:182` (`stronghold-types.ts:21-23`).
- mechanism: the message is a value returned to the page, not thrown, so nothing in the plugin stops the
  page from forwarding it to a persistent sink. `crust:logging` writes whatever message it is given to
  `app.log` (`src/plugins/logging.ts:161-178`) with `appendFile` and no `mode`, i.e. the process umask
  (commonly 0644, unlike the 0600 the vault itself uses). A key used as a secret — a recovery phrase, an
  account identifier, a token label — then survives the process on disk in cleartext in a file other
  local users can read.
- reachable by: `invoke("stronghold","get",{key:"<sensitive>"})` for a missing or corrupt entry, then
  `invoke("logging","write",{level:"error",message:result.message})` (or the page's own error reporter,
  which reaches `crashes.log` via `runtime-crash-write.ts:131-149`).
- smallest fix: name the key by a non-reversible id (e.g. the entry id) or omit it from the message and
  report it only in the successful result; if arbitrary text must be logged, give `app.log` mode 0600 on
  creation as the vault does.

## Checked and clean

- **No plaintext on the stronghold path** — `read`: `stronghold.ts:109-118` seals the name and value
  before any `writeStore`; `:133-135` unseals only after a hit; `stronghold-crypto.ts:70-100` uses a fresh
  12-byte IV per seal and HMAC for the entry index; `stronghold-file.ts:155-165` writes JSON containing
  only sealed fields. The sealed check marker (`stronghold-crypto.ts:120,137`) carries no password.
  `stronghold.test.ts:155-196` asserts the file bytes contain neither the key nor the value.
- **File permissions and atomicity** — `read`: `stronghold-file.ts:155-165` creates the temp file 0600,
  chmods again, and renames; the failure path removes the temp. The orphan-on-crash window is already
  recorded in `docs/reviews/hunt-20/16-persistence.md:29-33`; not re-reported here.
- **No secret in a process list or in compiled C** — `read`/`rg`: the keychain paths call
  `SecItem*`/`Cred*`/libsecret in-process; no `security`/`osascript` shell-out. The C sources written to
  `tmpdir()` (`darwin/keychain-ffi.ts:73-80`, `windows/keychain-ffi.ts:70-77`) are fixed source text
  hashed by content — no argument or secret reaches those files. `rg` found no `printf`/`fprintf`/`open`
  of a log in `118_keychain_a.c`, `119_keychain_b.c` or `48_keychain.c`.
- **No plaintext fallback for a missing adapter** — `read`: `keychain.ts:97-102,124,141,157,170` returns
  `not-implemented` naming the OS API; `linux/keychain.ts:87` omits `list` rather than inventing an
  answer. No file is written when the OS store is unavailable.
- **Name validation and empty-secret handling** — `read`: `keychain.ts:67-71` refuses empty and NUL-bearing
  service/account names; `:129-131` accepts an empty string as a real secret. `keychain.test.ts:58-117`
  pins both.
- **No logging inside the audited plugin files** — `rg` over `src/plugins/{keychain,stronghold}*.ts`
  found no `console.*`, `appendFile`, `writeFile` or telemetry call; persistence happens only through
  the stronghold file and the OS store described above.
