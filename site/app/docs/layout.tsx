import type { ReactNode } from "react";
import { Palette } from "@/components/palette";
import { Sidebar } from "@/components/sidebar";
import "./docs.css";
import "@/components/palette.css";

/**
 * Docs shell: a fixed rail, a centred column with hairline edges, and nothing else.
 * One page per node in `lib/nav.ts`, so the content is the navigation.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="shell">
			<Sidebar />
			<main className="prose">{children}</main>
			<Palette />
		</div>
	);
}
