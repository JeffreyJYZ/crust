# Lane K — `keychain`, the OS credential store

## Shipped

- `src/plugins/keychain.ts` + `keychain-types.ts`: `set`, `get`, `delete`, `list`. A missing credential
  is `{ ok: true, found: false }`, never an error. An empty secret is a real secret. A name with a NUL
  is refused, because a NUL truncates it inside the C string the OS is handed and two credentials could
  collapse onto one entry.
- darwin: `SecItemUpdate` then `SecItemAdd`, read with `SecItemCopyMatching`, delete with
  `SecItemDelete`, list with `SecItemCopyMatching` + `kSecMatchLimitAll`. Never `security` in a shell.
- win32: `CredWriteW` / `CredReadW` / `CredDeleteW`, resolved at runtime through `LoadLibraryA` +
  `GetProcAddress`.
- linux: `not-implemented`, naming libsecret and gnome-keyring.
- `src/runtime-keychain.ts` picks the half per platform; `runtime-plugins.ts` registers it on every arm.

## Traps measured here

- **`kCFBooleanTrue` must be the exported symbol, never a cast from `1`** — a `CFDictionary` value is a
  `CFTypeRef`, so a cast compiles and hands the framework a pointer to address 1, which faults inside
  Security.framework rather than at the boundary.
- **`SecItemUpdate` answers `errSecItemNotFound` (-25300) on the add path, and nothing else may fall
  through to `SecItemAdd`** — Butter deletes first, which leaves a window with no credential and loses
  it outright when the add then fails.
- **The Windows unit is its own translation unit, not a `shim-source.ts` part** — the window shim's
  declared-pointer count and module list are asserted by `imports.test.ts`, so welding a credential
  store in would move both for a surface that needs no window.
- **`GetProcAddress` calls wrap in this unit, so a source assertion must match across lines** — a
  `toContain('GetProcAddress(advapi, "CredReadW")')` failed on a legal line break.
- **The account list crosses as NUL-separated UTF-8, and that is only safe because the plugin refuses a
  NUL in a name** — the separator and the refused character are the same byte, which is what makes the
  split unambiguous.
- **Linux has no half and the row says so.** A plaintext file named "secure" is the one answer worse
  than a refusal, and the parity row names `not-implemented` so nobody reads the table as four
  platforms.
- **Windows `list` is absent on purpose** — `CredEnumerateW` is a fifth binding and a wildcard match;
  the plugin answers `not-implemented` naming it rather than an empty array that reads as "nothing is
  stored".

## Note on the brief

The brief asked for `set`, `get`, `delete`, `list` on all platforms. Linux and Windows `list` cannot be
honest, so both refuse by name; the other three commands work on both real platforms. This is recorded
in the parity row rather than hidden.
