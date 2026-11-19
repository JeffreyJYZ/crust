# `src/plugins/clipboard*`, `src/plugins/dialog*` — failure behaviour hunt — 07

Read-only source inspection. Scope: the four plugin families and the transport/native lines their
failure paths reach. Question asked: what the user sees when the call is malformed, the platform half
fails, or the bridge changes the payload shape. No GUI app launched, no cursor moved. All `file:line`
from `read`; the three `bun -e` probes noted `measured` only confirm the payload transform and the
resulting throw/message.

**Count: 4 findings** (1 high, 3 medium).

**Worst: F1 — `clipboard.writeImage` is unusable from a page: valid PNG bytes arrive as a JSON object
and every call answers `bad-request`.**

---

## F1 (high, worst) — `writeImage` requires real `Uint8Array` at the handler, but neither page bridge can send one

- `src/plugins/clipboard-image.ts:63-64` — `const png = args instanceof Uint8Array ? args : args?.png;`
  followed by `if (!(png instanceof Uint8Array) || !isPng(png))`. The only accepted shapes are a real
  `Uint8Array` or `{ png: <real Uint8Array> }`.
- `src/bridge/client/invoke.ts:130-138` — the fetch path always `JSON.stringify`s `args`; a
  `Uint8Array` serialises to `{"0":137,"1":80,…}`. There is no binary *request* branch, only a binary
  *result* tag (`:52-80`).
- `src/bridge/client/content-world-source.ts:148-159` — the darwin page-world `crustInvoke` likewise
  `JSON.stringify`s args, so content-world windows behave identically.
- `src/bridge/server/invoke.ts:173-183` — the parsed JSON object is passed to `run` unchanged; the
  server decodes no `__crustBytes` in requests (`bytes.ts` only encodes results).

**Reached:** a page follows the documented `window.crust.invoke("clipboard", "writeImage", { png })`
or the bare-bytes form. Both arrive as a plain object. `args instanceof Uint8Array` is false and
`args.png instanceof Uint8Array` is false, so `:64` answers
`{ ok:false, code:"bad-request", message:'clipboard.writeImage: "png" must be PNG bytes' }` —
measured with a real 11-byte PNG through a JSON round-trip. The feature works only for in-process
`app.invoke` or a raw HTTP caller using the binary route; from a page it fails 100% of the time.
The docs (`site/app/docs/guides/clipboard/page.mdx:13,39-40`,
`site/app/docs/reference/api-ui/page.mdx:68`) promise the opposite.

**Smallest fix:** decode the byte tag on the request side (accept `{ __crustBytes: base64 }` for
`png`, as `readImage` results already use), or have the page bridge encode a `Uint8Array` argument
before `JSON.stringify`. Keep the magic check after revival.

---

## F2 (medium) — `dialog.openPanel`/`savePanel` called with no arguments forward the bridge's `null` and die with a TypeError

- `src/plugins/dialog.ts:74-84` and `:91-101` — both handlers declare `options: OpenPanelOptions = {}`
  and forward `options` untouched to `native.pickOpen`/`pickSave`. A JS default only applies to
  `undefined`, not `null`.
- `src/bridge/client/invoke.ts:130-138` and `content-world-source.ts:157` — omitted `args` become
  `null` on the wire. `install.ts:129-131` normalises the *app* form to `{}` but the *plugin* form
  does not.
- `src/bridge/server/invoke.ts:176-182` — `parsed.args` (`null`) is passed straight to `run`.
- `src/platform/darwin/dialog.ts:77-84` (`options.title ?? ""`) and `:108-114` — dereferencing
  `options` when it is `null` throws; Windows `src/platform/windows/dialog.ts:128-133` and Linux
  `src/platform/linux/dialog.ts:146` dereference `panel.filters` the same way.

**Reached:** `window.crust.invoke("dialog", "openPanel")` (or `savePanel`) with no third argument —
legal, since `TypedInvoke` declares `args?`. The bridge sends `null`; the plugin forwards `null`
(measured: native received `null`); the native adapter throws `null is not an object (evaluating
'options.title')` (measured). The page gets `handler-error` / HTTP 500 with a JavaScript TypeError
instead of a file panel. No adapter-absence check helps, because an adapter is present.

**Smallest fix:** normalise at the plugin seam — `options: OpenPanelOptions = {}` becomes
`options && typeof options === "object" ? options : {}` (same in `savePanel`), so the public "no
options needed" signature survives the bridge.

---

## F3 (medium) — malformed `filters` throw deep in the wire builder instead of returning `bad-request`, and string `extensions` build a garbage filter

- `src/plugins/dialog-transport.ts:20-31` — `for (const filter of filters)` assumes every filter is an
  object; `:22` `for (const raw of filter.extensions)` assumes an iterable; `:24` `raw.trim()` assumes
  a string; `:30` `filter.name.trim()` assumes a string name.
- `src/plugins/dialog.ts:83,100` and `:105-123` — options are forwarded verbatim; no validation
  exists anywhere on this path (`createRunner` only checks capability and JSON parse).

**Reached:** a page sends `{ filters: [{}] }` → `filter.name` is `undefined` → TypeError at `:30`;
`{ filters: [null] }` → TypeError at `:22`. Both surface as `handler-error` / HTTP 500 with a raw
JS message, not `bad-request`. More insidious: `{ filters: [{ name: "T", extensions: "txt" }] }`
iterates the *characters* of the string and silently produces `T|*.t;*.x` (measured), so the panel
offers `*.t` and `*.x` instead of `*.txt` with no error at all. Filter names containing `|` or `\n`
also corrupt the `Name|*.ext\nName|*.ext` wire format at `:31-33`.

**Smallest fix:** validate `filters` at the plugin boundary (array of `{ name: string, extensions:
string[] }`) and answer `bad-request` before calling the adapter; escape or reject `|`/`\n` in names
inside `filterSpec`.

---

## F4 (medium, native half reached through `dialog.cancel`) — a cancel that times out leaves the open pick pending forever and locks dialogs in `busy`

- `src/platform/darwin/dialog.ts:133-157` — `cancel()` waits for `sheetDone()` up to
  `SHEET_CANCEL_TIMEOUT_MS` (2000 ms, `panel-status.ts:58`). The `throw` at `:143-147` is inside the
  `while`, before `pending?.abandon()` at `:155`.
- `src/platform/darwin/dialog.ts:58-73` — `pending` is the one sheet slot; `awaitSheet` installs it,
  and `awaitSheetResult` (`sheet.ts:28-31`) only returns early when `abandoned()` is true.
- `busyRefusal` (`panel-status.ts:63-74`) — any later `openPanel`/`savePanel` while the C sheet is
  still up is refused as busy, and the refusal tells the page to call `dialog.cancel` — which just
  failed.

**Reached:** a sheet is up; the page calls `dialog.cancel`; `-cancel:` is sent (`sheetCancel()` returns
1) but the completion handler never sets `sheetDone` within 2 s. `cancel()` rejects with a
`handler-error`, `abandon()` is never called, so the page's original `openPanel` promise stays
unsettled and the C side still reports one live sheet. Every subsequent file-panel call is refused
`busy` with advice to use the command that just failed. The page hangs and cannot recover without a
human clicking Cancel.

**Smallest fix:** move `pending?.abandon()` into a `finally` in `cancel()`, so a timeout still
settles the waiting pick as `{ paths: [] }` and frees the slot; reset the C sheet state on the same
path.

---

## Checked and clean

- **Adapter-absent / missing-method mapping** — `clipboard.ts:37-38,54-55`,
  `clipboard-image.ts:31-32,59-60` answer typed `not-implemented`/`unknown-adapter`; `dialog.ts:77-82,
  94-99,109-114` name the selector and the adapter to pass. No empty success is returned for a
  missing platform half (`define.ts:64-71`, `plugins/registry.ts:82-85`).
- **Native throw containment** — `clipboard.ts:40-44,67-71` and `clipboard-image.ts:34-38,72-76` turn
  adapter throws into typed `handler-error` with the throw's own message; the windows clipboard's
  transient `OpenClipboard` failure (`platform/windows/clipboard.ts:42-44,48,53,69`) becomes that
  typed error, not an empty clipboard.
- **Write verdicts** — `clipboard-contract.ts:97-109` distinguishes `written`, `refused`
  (`write-failed`) and `missing` (`not-implemented`); the empty string is a legitimate write
  (`clipboard.ts:56-65`) and zero bytes is an empty image pasteboard (`clipboard-image.ts:51-52`).
- **Image adapter lying** — `clipboard-image.ts:44-50` checks `instanceof Uint8Array` before length,
  so `""`/`[]` cannot masquerade as an empty pasteboard; `isPng` (`clipboard-contract.ts:67-70`)
  rejects non-PNG magic before the adapter is touched.
- **Native refusal propagation** — `dialog.ts` forwards native rejections unchanged, and the tests
  assert this (`dialog.test.ts:138-145`, `dialog-save.test.ts:109-119`); cancellations stay `{ paths:
  [] }` and `cancel` with nothing pending stays `{ cancelled:false }` rather than an error.
