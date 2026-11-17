# Single-file mode

Area: `src/single.ts`, `single-build.ts`, `single-detect.ts`, `single-html.ts`, `single-page.ts`, `single-runner.ts`, `single-extensions.ts` and the `e2e:single` probe.

## Findings

### 1. `hasDefaultExport` misclassifies ordinary source shapes — MEDIUM
`src/single-page.ts:32-37`

The default-export test is a line-anchored regex, not a syntax check. It misses a genuine default export written after other code on one line (`const A = 1; export default A;` → false), and it matches `export default` or `export { x as default }` appearing inside a template literal, block comment or string (all → true). Detection decides whether the file is mounted as a React component or loaded for side effects, and both wrong directions are reachable by normal pages.

**Breaks:** A component written `const A = () => <div/>; export default A;` is loaded for side effects, `#root` stays empty and the user sees a blank window with no error. A side-effect page that prints a code sample in a template literal is wrapped by `mountSource`, so `requireReact` first demands `react`/`react-dom` that the page does not need; if those happen to be installed, the wrapper throws `crust: the default export is not a React component` because `entry.default` is undefined.

**Evidence:** `return /^\s*export\s+default\b/m.test(source) || /\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source);` — because `\s*` cannot consume `;`, the one-liner returns false; the second regex has no notion of strings/comments, so `document.body.textContent = \`\nexport default function Fake(){}\n\`;` returns true. Confirmed by evaluating the exact regexes in `bun -e`: `oneline false`, `template true`, `blockcomment true`, `string true`.

### 2. React mount accepts React 17, then uses React 18-only API — MEDIUM
`src/single-page.ts:53-59` and `src/single-page.ts:89-93`

`requireReact` only checks that `node_modules/react/package.json` and `node_modules/react-dom/package.json` exist somewhere above the file. The generated mount then hard-depends on `import("react-dom/client")` and `createRoot`, which exist only in React 18+. A project with react@17/react-dom@17 passes the check and breaks later. The resolver makes it worse: `resolveFromProject` (`src/single-page.ts:67-72`) catches a failed `Bun.resolveSync("react-dom/client", dir)` and returns `undefined`, letting Bun resolve from the wrapper's directory or global cache, so the failure can surface as a mismatched-React runtime error instead of a clean build message.

**Breaks:** A user with an otherwise valid React 17 install gets either a bundler "Could not resolve: react-dom/client" naming a generated file, or an invalid-hook-call at runtime — neither points at the real cause (needs React 18+). The error message from `requireReact` promises success after `bun add react react-dom`, which is false for React 17.

**Evidence:** `if ((await installed("react", dir)) && (await installed("react-dom", dir))) return;` — no version check. `'\timport("react-dom/client"),'` and `createRoot(mount).render(...)` — React 18 API. `catch { return undefined; }` in the onResolve handler silently drops the failure.

### 3. No test covers the default-export/React single-file path — LOW
`scripts/single/fixture.ts:62-71`, `scripts/e2e-single.ts:56`

Every e2e:single page is the no-default-export fixture ("No default export: this page owns the DOM and proves the round trip itself"), and the html fixture has no importable module either. `rg` over `src/**/*.test.ts` finds no test referencing `hasDefaultExport`, `mountSource`, `requireReact`, or `resolveFromProject`. The whole React mount half of single-file mode — including the two defects above — is unguarded.

**Breaks:** Regressions in mounting, React resolution and the shape heuristic can ship green. The docs promise `export default` mounting as the headline single-file behavior, so the untested path is the common one, not an edge case.

**Evidence:** `rg -n 'hasDefaultExport|mountSource|requireReact|resolveFromProject' src --glob '*.test.ts'` → no matches; `scripts/single/fixture.ts:66` → `// ... No default export:`.

## Coverage

Read all of `src/single.ts`, `src/single-build.ts`, `src/single-detect.ts`, `src/single-page.ts`, `src/single-runner.ts`, the three single `src/*.test.ts` files, the whole `scripts/e2e-single.ts` probe and `scripts/single/**`, plus the callers `src/cli/dev.ts`, `src/cli/build.ts`, `src/cli/dev/single.ts`, `src/cli/build/single-app.ts`, `src/cli/build/wrapper.ts`, `src/cli/build/assets.ts`, `src/runtime.ts`, `src/runtime-shim.ts`, `src/runtime-single.ts`, `src/app.ts`, `src/cli/framework.ts`, `src/config/load.ts`, the bridge content-type table and the single-file docs pages. Checked the HTML generation path for `</script>`/`-->` break-out: `documentSource` interpolates only an escaped title and fixed constants, and the `INVOKE_SHIM` injection lives in the bridge, not here — no defect found. Checked cwd-relative reads: `buildPage`, `buildSingle` and `devRunnerSource` all use absolute paths derived from `app.dir`/`pageDir` — no defect found. Checked `detectSingle`'s project-vs-single decision against the documented rule — it matches. Did not run the full gate or any build (other agents in the tree), did not touch another hunter's report, and did not open the platform barrels or packaging internals beyond the single-file wrapper. Next I would probe the `.html` build's `injectShim` behavior on documents with no `<body>` and exercise `hasDefaultExport` against a real bundling run to see which direction fails first.

