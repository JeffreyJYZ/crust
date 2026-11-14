import createMDX from "@next/mdx";
import type { NextConfig } from "next";

/**
 * Markdown is the documentation, so `.mdx` files are routes themselves: a page is a
 * file, a section is a folder, and there is no content pipeline to keep in sync.
 */
const withMDX = createMDX({});

const config: NextConfig = {
	pageExtensions: ["ts", "tsx", "mdx"],
	experimental: { mdxRs: false },
};

export default withMDX(config);
