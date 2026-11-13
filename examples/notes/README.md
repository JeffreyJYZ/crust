# notes

A two-pane note app, and the framework's proof that a real app is a few plain
files. It lists Markdown files from a `notes/` directory, opens one in an
editor, saves it with a button or ⌘S, and deletes one after an inline
confirmation. No framework, no bundler, no external request.

## What it demonstrates

- **A plugin used from Bun code, not only from the page.** `main.ts` calls
  `fsPlugin.commands.readTextFile` and `writeTextFile` directly. The page never
  touches the filesystem; it calls the app's own commands.
- **A typed result for every command.** Each one answers
  `{ ok: true, value }` or `{ ok: false, code, message }`, where `code` is
  `bad-name`, `bad-text`, `not-found` or `io-error`. A refused name is data the
  page renders, not an exception that loses its reason.
- **A containment check on page-supplied input.** A note name is untrusted:
  `paths.ts` rejects empty names, absolute paths, separators, `.`/`..`, NUL
  bytes, a leading dot and anything outside a small ASCII set, then resolves the
  file and asserts it is exactly one segment inside `notes/`. A `lstat` before
  every read, write and delete refuses a symlink, so a planted link cannot lead
  out of the directory either.
- **A frontend a built app can embed.** `public/` is three files — HTML, CSS,
  JS — served fresh by the bridge in dev and embedded whole in the bundle.
- **Dark by default, light from `prefers-color-scheme`**, with no web font.
- **Keyboard-only use.** Tab reaches every control, ↑/↓ (and Home/End) move
  through the list, Enter opens, ⌘S (or Ctrl+S) saves, Escape cancels a delete.

## Run it

From the crust checkout:

```sh
bun run src/cli/index.ts dev --dir examples/notes
```

A project that installed crust writes the same thing as `bunx crust dev`.

The window is 1000×700, titled **Notes**. On `ready` the backend creates
`notes/` in the directory crust runs from — for this command,
`examples/notes/notes/` — and prints its path:

```
  notes     /…/crust/examples/notes/notes
```

Add a note with the field at the top of the sidebar, type, press ⌘S, and the
file appears as `notes/<name>.md`. The directory is gitignored; delete it and
the app recreates it on the next launch.

## Build it

```sh
bun run src/cli/index.ts build --dir examples/notes
```

`crust build` compiles the backend, embeds every file under `public/`, and
assembles and ad-hoc signs `examples/notes/dist/Notes.app`. The build prints the
asset count, the binary size and the bundle size. A built app keeps its notes in
`notes/` relative to the directory it is launched from, because the bundle has
no project directory to write into.

## Test the guard

```sh
bun test examples/notes/paths.test.ts
```

`paths.test.ts` exercises the escape cases (`../etc/passwd`, `/etc/passwd`,
`a/b`, `a\b`, a NUL byte, empty, `.`, `..`, a leading dot, an over-long name)
and asserts that every accepted name resolves to a file whose parent is the
notes directory. The guard is pure, so this needs no window, no bridge and no
filesystem writes.

## The commands

| Command | Arguments | Result |
| --- | --- | --- |
| `notes.list` | — | `{ names }`, sorted, `.md` removed |
| `notes.read` | `{ name }` | `{ name, text }` |
| `notes.write` | `{ name, text }` | `{ name, bytes }` |
| `notes.remove` | `{ name }` | `{ name }` |

The page reaches them through the two-argument shim form,
`window.crust.invoke("notes.read", { name })`, which routes to the `app`
namespace. `crust:fs` is still the plugin the config names; `remove` uses
`unlink` because the v1 plugin has no remove command, and `list` uses `readdir`
for the same reason.

Limits: a name is at most 64 characters, and a note body at most 256 KiB.
