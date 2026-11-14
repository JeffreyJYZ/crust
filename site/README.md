# crust docs

The documentation site. Every page is an `.mdx` file under `app/`, which makes the file
tree the sitemap and the navigation a single list in `lib/nav.ts`. Nothing is generated and
no content pipeline sits in between.

```sh
bun install
bun run dev      # http://localhost:4321
bun run build    # static export of every route
```

The repo gate runs `bun run site:build` and `bun run check:links` (from the repo root) when
`site/` changes: the build catches a page that does not compile, and the link checker catches
a link to a page that does not exist. Pages stay under 200 lines like every other file; the
cap is enforced by `bun run check:lines`.

Layout is two files: `app/docs/layout.tsx` for the rail, `app/(home)/layout.tsx` for the
landing page. Styling is `app/globals.css` (type, tables, code) plus one small CSS file per
shell — there is no component library and no Tailwind.

To add a page: create `app/docs/<section>/<slug>/page.mdx` and add one line to
`lib/nav.ts`. That is the whole contract.
