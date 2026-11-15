import type { MDXComponents } from "mdx/types";
import { Accordion, AccordionItem } from "@/components/accordion";
import { TabPanel, Tabs } from "@/components/tabs";

/**
 * Required by `@next/mdx`. Elements are styled once in `app/globals.css` rather than
 * per component; the two ui-sdk components are the only additions, because a tab or a
 * collapsible group has no Markdown spelling.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
	return { ...components, Accordion, AccordionItem, Tabs, TabPanel };
}
