import type { MDXComponents } from "mdx/types";

/**
 * Required by `@next/mdx`. The elements are styled once in `app/globals.css`
 * rather than per component, so this stays a pass-through and there is no second
 * place for a heading to pick up a different size.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
	return components;
}
