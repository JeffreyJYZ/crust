# dogear

A two-pane markdown notes editor: a React page in front of a folder of `.md` files,
built into a `.app` by `crust build`. It is meant to be copied, so it uses most of
the plugin surface rather than one call.

Notes are ordinary files. The app keeps them in `~/Documents/Dogear` by default and
seeds `welcome.md` on first run.

## What it demonstrates

- **`fs` called from the page, not from the backend.** The sidebar is `fs.list`
  and `fs.stat`; opening a note is `fs.readTextFile`; saving is `fs.writeTextFile`;
  renaming is `fs.rename`; deleting is `fs.remove`. `desktop/main.ts` owns only the
  three things a page cannot do — create the notes folder (`fs` has no `mkdir`),
  print a line to the terminal, and quit.
- **A backend of three commands.** `boot` answers `{ dir, selfcheck }`, `log`
  mirrors a page line onto stdout, `quit` ends the process. Everything else is a
  plugin call over the same bridge.
- **The window title tracks the open note.** `window.setTitle` runs on every
  switch, save, rename and delete, and carries a `•` while the editor holds
  unsaved text. The adapter reads the applied title back before answering `ok`.
- **A menu-bar item with a menu.** `tray.setTitle` and `tray.setMenu` create five
  rows — Save now, Cancel panel, Close window, Reopen window, Quit Dogear. A
  click arrives as the `tray:click` event, so the meaning of each row lives in
  the page.
- **A way out of a sheet.** `dialog.cancel` ends whatever picker is up, the way
  the panel's own Cancel button would: the invoke that is waiting for a pick
  resolves `{ paths: [] }`, and nothing is written. It is a menu-bar row rather
  than a page button because a picker is a *sheet* — AppKit disables the window
  it is attached to, so a control behind it could never be clicked, while the
  menu bar is outside that window.
- **The native folder picker.** `dialog.openPanel` opens an `NSOpenPanel` as a
  sheet and answers with the absolute path the user chose.
- **The native save panel.** **Save as…** calls `dialog.savePanel` with the open
  note's name and a markdown extension list, then writes the editor's text to
  whatever path it answers with through the same `fs.writeTextFile` the plain
  Save uses. An empty `paths` — the user cancelling, or the tray's Cancel panel —
  writes nothing and says so in the status bar; it is not an error and never an
  empty file.
- **A real bundler front end.** React 19 through Vite, with `crust/vite` putting
  `window.crust` into the document Vite serves. `build.assets` points at
  `dist/web` so `crust build` embeds the built page and never its own output.
- **Dark by default**, light from `prefers-color-scheme`, and no web font.

## Run it

From this directory:

```sh
bun install
bun run dev
```

`bun run dev` is `crust dev --entry desktop/main.ts`, using the `crust` copy the
dependency installed. Because this example lives inside the crust repository, the
same run can use the checkout's own CLI:

```sh
bun run ../../src/cli/index.ts dev --entry desktop/main.ts
```

Either way the window is 1040×720, titled **Dogear**, and the terminal prints the
folder it is using:

```
  dogear    notes live in /…/Documents/Dogear
```

Closing the window leaves the app in the menu bar — that is what the tray's
Reopen window row is for, and the page keeps its editor state while it is gone.
The Quit Dogear row ends the process. If a picker is up, the Cancel panel row
ends it: the window behind a sheet is disabled, so the menu bar is the one place
still live until the sheet is answered.

## Build it

```sh
bun run build
dist/Dogear.app/Contents/MacOS/crust-app
```

`crust build` runs `build.beforeBuildCommand` (the Vite build), embeds every file
under `dist/web`, compiles the backend, assembles `Dogear.app` and ad-hoc signs it.
Launch the binary inside the bundle directly — never `open` it, which routes
through LaunchServices, raises Gatekeeper dialogs and hides the real exit status.
macOS arm64 only; a recipient on another Mac needs
`xattr -dr com.apple.quarantine "Dogear.app"`.

## Prove it works

Set `DOGEAR_SELFCHECK=1` and the page runs its own checks on load, using the same
calls the UI uses and printing one line per answer through the `log` command:

```sh
cd /                         # a launched bundle runs with / as its cwd
DOGEAR_SELFCHECK=1 DOGEAR_NOTES_DIR=/tmp/dogear-notes \
	/…/examples/dogear/dist/Dogear.app/Contents/MacOS/crust-app
```

```
  page      PASS notes listed — 1 markdown file(s) in /tmp/dogear-notes (welcome.md)
  page      PASS note stat — /tmp/dogear-notes/welcome.md · … bytes · modified …
  page      PASS note read — welcome.md · … chars, starts "# Welcome to Doge"
  page      PASS window title — "Dogear — welcome.md" read back from the window
  page      PASS tray item — menu with 5 rows: Save now, Cancel panel, Close window, Reopen window, Quit Dogear
  page      PASS save — _selfcheck.md · 62 bytes through fs.writeTextFile
  page      PASS save read back — _selfcheck.md · 62 chars match what was written
  page      PASS rename — _selfcheck.md → _selfcheck-renamed.md
  page      PASS remove — _selfcheck-renamed.md removed from /tmp/dogear-notes
  page      PASS dialog sheet — NSOpenPanel is up; a pick needs a human, so it stays pending
  page      PASS save panel — NSSavePanel is up; the folder sheet was cancelled by the page and its pending invoke resolved with no path; a pick needs a human, so this one stays pending
  page      done
```

The sizes and timestamps are whatever the notes are; the `_selfcheck.md` figures
are the scratch file the run writes and deletes. `DOGEAR_NOTES_DIR` must be
absolute; it is the one input that lets a scripted run use a scratch folder instead
of `~/Documents/Dogear`. The same lines appear in the **Diagnostics** panel, which
also has a **Run self-check** button.

That is eleven steps, and the last one is the save panel. Everything but the
panels is a real answer from a real call. A *pick* needs a human, so no run has
ever completed one — which is why the save-panel step writes nothing even in the
branch where it is handed a path — and the save panel is left up, unresolved, on
purpose. The folder sheet is the one panel answer a run can produce, and step 10
is where it happens: it calls `dialog.cancel`, then requires the invoke step 9
started to resolve with no path. A cancel that answered `ok` while leaving that
invoke pending fails the step, which is the difference between proving a cancel
and reporting one.

No menu-bar click was produced, and the page cannot produce one: a page payload
is JSON, so the tray adapter wires each row's handler in-process, and a click only
ever comes from the menu bar itself. What is proven is the menu's state — five
rows, read back from the adapter — and every call the rows dispatch to, which the
steps above exercise directly. Each row is therefore proven up to the switch that
dispatches it; the click that reaches that switch is not.

## Two things that cost a debugging session

- **The backend entry belongs under `desktop/`, and the page modules are `.tsx`.**
  `crust dev` watches the backend entry's *directory*, recursively — so an entry
  at the project root means the whole project is watched, `src/` included. A
  restart rotates the bridge token, and the page already on screen then fails with
  a missing bearer token. The CLI skips a dev-server project's `.tsx` and `.css`
  (Vite's own reload owns those) but deliberately not `.ts`, which is where a
  command or plugin lives — so a page module written as `.ts` and living under the
  watched directory restarts the backend on every save; `crust doctor` lists the
  page-side `.ts` files it finds as `dev watch`, whether or not the watch currently
  reaches them. `--entry desktop/main.ts` keeps the watch to `desktop/`, and
  `bridge.tsx`, `notes.tsx` and `selfcheck.tsx` are named that way on purpose:
  they hold no JSX, and the extension is what keeps a save in them from restarting
  the backend if the entry ever moves to the root.
- **Every path the page sends to `fs` must be absolute.** A launched `.app` runs
  with `/` as its working directory, so a relative path resolves to `/welcome.md`
  and fails with `not-found`. The page has no idea where the bundle came from, so
  `boot` answers with the absolute notes folder and the page joins names onto it
  (`notePath` in `src/notes.tsx`). The same applies to the Vite dev server: the
  page that works in dev would silently break in the bundle without this.

## Layout

```
crust.config.ts     the app: dev url, one window, the Vite build hooks
desktop/main.ts     backend: boot (create + seed the folder), log, quit
index.html          Vite's entry; the page mounts at #root
src/App.tsx         the UI: list, editor, rename/delete, tray, window title
src/notes.tsx       note rules shared by the page and its self-check
src/bridge.tsx      the typed window.crust surface this app uses
src/selfcheck.tsx   the PASS/FAIL sequence behind DOGEAR_SELFCHECK=1
src/styles.css      dark by default, light from prefers-color-scheme
vite.config.ts      React + the crust plugin, port pinned to dev.url
```

Notes:
- The three page modules that end in `.tsx` hold no JSX. The extension is what
  keeps a save in them out of the backend watcher; the reason is in the section
  above.
- The app never writes outside the notes folder, and the only file it creates for
  itself is the `_selfcheck.md` scratch file, which it renames and deletes again.
- `bun.lock` is gitignored here on purpose: the example pins `crust` as a
  `github:` dependency, and a lockfile would freeze a commit the repository moves
  past. `bun install` resolves the current one.
