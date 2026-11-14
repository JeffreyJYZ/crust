import createMDX from "@next/mdx";
import type { NextConfig } from "next";
import remarkGfm from "remark-gfm";

/**
 * Markdown is the documentation, so `.mdx` files are routes themselves: a page is a
 * file, a section is a folder, and there is no content pipeline to keep in sync.
 *
 * `remark-gfm` is not optional here — without it every `| key | value |` table ships as
 * literal pipe text, which is how the first build looked in a browser while the HTML
 * check passed.
 */
const withMDX = createMDX({ options: { remarkPlugins: [remarkGfm] } });

const config: NextConfig = {
	pageExtensions: ["ts", "tsx", "mdx"],
	experimental: { mdxRs: false },
};

export default withMDX(config);
