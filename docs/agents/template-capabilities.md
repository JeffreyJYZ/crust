# Lane B — capabilities in the five templates

**Every scaffold grants `app:invoke`.** The five pages call `invoke("greet", …)`, which `install.ts`
routes as the app form and `runtime-app-namespace.ts` serves as the `app` plugin's `invoke` command —
so the action the bridge gates is `app:invoke`, not `greet`. Verified by reading
`src/bridge/client/install.ts:108-111` (`call(APP, "invoke", …)`) and
`src/config/validate-security.ts` (spelling is `plugin:command`).

**Declaring the capability is what makes the model visible.** `capabilities` present and non-empty is
the only way to reach deny-by-default (`src/bridge/server/capabilities.ts:8-12`); an empty or absent
list is `OPEN`, so a template with no block teaches nothing. The brief's "an app-only page needs no
capability" clause was read as covering a page that calls *nothing* — none of the five do — because
the lane's own required test asserts a grant exists and that it covers every page call.

**A grant of one internal action is the minimum honest sample.** No template page calls a plugin, so
`ui`/`fs`/`dialog` wildcards would be invented authority, which the brief forbids. Each config's
comment says the block exists, what it grants, and that widening it is how a plugin call is admitted.

**Test: `scripts/release/template-security.test.ts`.** Reads each page, extracts `.invoke(…)` in both
forms (app → `app:invoke`, plugin → `plugin:command`), compiles the config's real capability table and
asserts `allows("main", action)` for each. Also asserts every `grants` name is declared, and that all
five `crust init` scaffolds write a token-free config that `validateConfig` accepts.

**Proof it is a real test:** deleting only the `security` block from `templates/vue/crust.config.ts`
reddens two cases (`templates/vue`, and the init case) and nothing else.

**Config files are data, not modules.** The test evaluates each `crust.config.ts` with the `import type`
line and `satisfies CrustConfig` stripped (`new Function`). Importing the file for real would pull the
`crust` package into a template test, and `{{name_text}}` is a bare identifier there — the template is
only type-valid after `init` substitutes it.

**File counts are untouched** — `scripts/build-standalone.ts` pins 8/6/7/7/6 and no file was added or
removed under `templates/`, only content. `bun run check:lines` stays green (both edited configs are
~22 lines, the test 123).
