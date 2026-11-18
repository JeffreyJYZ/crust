# a11y-page-tree

- `installPageA11y` is serialized with `Function.prototype.toString()` into both served and dev snippets; every runtime value must live inside the function — a module-scope const vanishes in the page.
- The 200-line split is at the type-contract boundary: shapes in `a11y-page-types.ts`, injected code in `a11y-page.ts`. Runtime helpers cannot be extracted because serialization drops module scope.
- `pageTree` reports DOM (`source: "dom"`) with a note that it is not the OS accessibility tree; reading another process's tree needs a trust crust does not have, so a green tree is not screen-reader proof.
- `focusElement` checks `document.activeElement` after `.focus()`; a fake DOM that always focuses hides the refusal, so test doubles must refuse a div without tabindex.
- Both `bootstrapSource` and `pageClientSource` pass the factory; a hand-built `installCrust` without it has no `crust.a11y`.
- Prove with `bun test src/bridge/client/a11y-page.test.ts`, `bun check`, `bun run check:lines`.
