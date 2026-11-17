# cli lane — fix wave

Lane `cli`, owns `src/cli/**` except `sign.ts` and `src/single*.ts`. Reports:
`docs/reviews/defects-wave3/05-cli.md` (findings 1–5) and `18-single.md` (findings 1–3).
All eight findings fixed. No other lane's file was touched.

## 05-cli.md — fixed

- **1 — value flags ate the next flag** (`src/cli/parse.ts:50-71`). `--dir/--config/--entry/--format`
  now peek at `argv[index+1]`; a missing token or one starting with `-` leaves the flag unconsumed
  and records `missingValue`. The error is returned only when help/version are not answering, so
  `crust init --dir --help` prints help instead of creating a `--help` directory.
- **2 — doctor false-failed `.html/.ts/.js` singles** (`src/cli/doctor/environment.ts:8,18-31`).
  Dropped the local `PAGE_EXTENSIONS = {.tsx,.jsx}`; `isPageFile` and `solePageFile` now use
  `SINGLE_EXTENSIONS` from `@/single`, the same set `detectSingle` accepts. Hint text at `:96`
  changed `<file.tsx>` to `<file>` so it no longer excludes the extensions it accepts.
- **3 — help omitted `.html`** (`src/cli/usage.ts:12`). Added `.html` to the single-file list.
- **4 — help understated `--entry` fallbacks** (`src/cli/usage.ts:33`). Now `(default: src/main.ts,
  then main.ts)`, matching `resolveBackendEntry`'s two candidates.
- **5 — help/version lost to validation** (`src/cli/parse.ts:26-31,93`). `help`/`version` are
  detected in a pre-scan and short-circuit every command-specific error and validation branch.
  `parse(["--help","--react"])` and `parse(["--version","--format","dmg"])` now exit 0 with the
  answer; smoke-checked both through `bun run src/cli/index.ts`.

## 18-single.md — fixed

- **1 — `hasDefaultExport` misclassified source shapes** (`src/single-export.ts:10,66`, new file).
  Replaced the line-anchored regex with a small tokenizer (`codeOnly`) that blanks `//`, `/* */`,
  single/double-quoted strings and template literals while keeping newlines; the export regexes then
  run on code only, with a statement boundary so a JSX text `>export default` does not match.
  `const A = 1; export default A;` is now true; sample code in a template, block comment or string
  is false. `export type { X as default }` is excluded. File moved out of `single-page.ts`; that
  file re-exports it so `single-build.ts` and the `single.ts` barrel are unchanged.
- **2 — React 17 passed then hit React 18 API** (`src/single-react.ts:12,18,42,70`, new file).
  `requireReact` now reads real `node_modules/<pkg>/package.json` versions at or above the project
  and rejects: missing packages (`bun add react react-dom`), a major below 18 (`need React 18+`,
  names the installed versions — the mount uses `react-dom/client`/`createRoot`), and mismatched
  react/react-dom majors. `resolveFromProject` no longer returns `undefined` on a failed
  `Bun.resolveSync`; it throws with the cause so `buildPage` reports a clean build error instead of
  letting Bun fall back to a global cache and fail at runtime.
- **3 — no React/default-export test** (`src/single-page.test.ts`, new file). Covers the whole
  previously unguarded half: shape detection (five shapes plus the reported false negatives),
  `mountSource` output, all `requireReact` branches, and a `buildPage` integration proving a React
  17 project is rejected before bundling.

## Tests added

- `src/cli/parse.test.ts` — "value-taking flags" (flag not eaten; `--help`/`--version` after a
  value flag; missing-value error preserved) and "global help and version" (short-circuit
  `--react`/`--format` validation and unknown options). Five cases.
- `src/cli/doctor/command.test.ts:72` — configless `app.html`, `app.ts` and `app.js` each pass
  doctor (exit 0, no `config [fail]`, `all checks passed`).
- `src/single-page.test.ts` — 12 cases as above; every one fails against the pre-fix code.

## Verification

- `bun test src/cli/parse.test.ts src/cli/doctor/command.test.ts src/single-page.test.ts` — 32 pass,
  0 fail (plus 14 pass in `commands.test.ts`, `build.test.ts`, `dev/entry.test.ts`).
- `bun check` — clean for every file in my list. Four errors remain in
  `src/packaging/extension-compile.ts` (duplicate `compileExtension`) and were present from another
  lane's concurrent edit; not mine, not touched.
- `bun fmt` on the nine changed files — one file reformatted (`environment.ts` import wrap).
- `bun run check:lines` — PASS, no file over 200 lines. New files: `single-export.ts` 72,
  `single-react.ts` 88, `single-page.test.ts` 129; `single-page.ts` now 86.

## Durable notes

- `Bun.BunPlugin` `OnResolveResult` in this repo's `bun-types` has `path` and no `errors` field, so
  a plugin cannot return build errors from `onResolve`; throw inside the callback and `buildPage`'s
  `catch` turns it into a clean failure message.
- `parse` narrowing: `const value = argv[++index]` is `string | undefined` to the type checker even
  after checking `argv[index+1]`; assign the already-narrowed peek (`const value = candidate`) after
  `index++` instead.
- Global help/version must be pre-scanned, not accumulated in the loop: a value flag before
  `--help` would otherwise return its "needs a value" error before the loop ever sees the flag.
