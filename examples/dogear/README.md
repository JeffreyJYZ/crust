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
- **A menu-bar item with a menu.** `tray.setTitle` and `tray.setMenu` create four
  rows — Save now, Close window, Reopen window, Quit Dogear. A click arrives as
  the `tray:click` event, so the meaning of each row lives in the page.
- **The native folder picker.** `dialog.openPanel` opens an `NSOpenPanel` as a
  sheet and answers with the absolute path the user chose.
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
The Quit Dogear row ends the process.

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
  page      PASS tray item — menu with 4 rows: Save now, Close window, Reopen window, Quit Dogear
  page      PASS save — _selfcheck.md · 62 bytes through fs.writeTextFile
  page      PASS save read back — _selfcheck.md · 62 chars match what was written
  page      PASS rename — _selfcheck.md → _selfcheck-renamed.md
  page      PASS remove — _selfcheck-renamed.md removed from /tmp/dogear-notes
  page      PASS dialog sheet — NSOpenPanel is up; a pick needs a human, so it stays pending
  page      done
```

The sizes and timestamps are whatever the notes are; the `_selfcheck.md` figures
are the scratch file the run writes and deletes. `DOGEAR_NOTES_DIR` must be
absolute; it is the one input that lets a scripted run use a scratch folder instead
of `~/Documents/Dogear`. The same lines appear in the **Diagnostics** panel, which
also has a **Run self-check** button.

The folder picker is the honest exception: the sheet starts and the invoke stays
pending, and only a human can choose a folder or cancel. That check reports the
sheet, not a pick, and no run here has ever completed one. Likewise, no menu-bar
click was produced — the menu's state is read back, and the `tray:click` handler
is a switch on the label.

## Two things that cost a debugging session

- **The backend entry belongs under `desktop/`, not at the project root.** `crust
  dev` watches the backend entry's *directory*, recursively — so an entry at the
  root means the whole project is watched, `src/` included. A restart rotates the
  bridge token, and the page already on screen then fails with a missing bearer
  token. The CLI skips a dev-server project's `.tsx` and `.css` (Vite's own reload
  owns those) but deliberately not `.ts`, which is where a command or plugin
  lives — and this example's `src/bridge.ts` and `src/notes.ts` are exactly that
  kind of page-side `.ts`, so a save there would restart the backend. `--entry
  desktop/main.ts` keeps the watch to files that belong to the backend.
- **Every path the page sends to `fs` must be absolute.** A launched `.app` runs
  with `/` as its working directory, so a relative path resolves to `/welcome.md`
  and fails with `not-found`. The page has no idea where the bundle came from, so
  `boot` answers with the absolute notes folder and the page joins names onto it
  (`notePath` in `src/notes.ts`). The same applies to the Vite dev server: the
  page that works in dev would silently break in the bundle without this.

## Layout

```
crust.config.ts     the app: dev url, one window, the Vite build hooks
desktop/main.ts     backend: boot (create + seed the folder), log, quit
index.html          Vite's entry; the page mounts at #root
src/App.tsx         the UI: list, editor, rename/delete, tray, window title
src/notes.ts        note rules shared by the page and its self-check
src/bridge.ts       the typed window.crust surface this app uses
src/selfcheck.ts    the PASS/FAIL sequence behind DOGEAR_SELFCHECK=1
src/styles.css      dark by default, light from prefers-color-scheme
vite.config.ts      React + the crust plugin, port pinned to dev.url
```

Notes:
- The app never writes outside the notes folder, and the only file it creates for
  itself is the `_selfcheck.md` scratch file, which it renames and deletes again.
- `bun.lock` is gitignored here on purpose: the example pins `crust` as a
  `github:` dependency, and a lockfile would freeze a commit the repository moves
  past. `bun install` resolves the current one.
