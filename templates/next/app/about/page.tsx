"use client";

import Link from "next/link";

/**
 * A second route, so the scaffold proves client-side navigation instead of only the first
 * paint: `output: "export"` emits `/about/index.html`, and the link below is handled by the
 * router in the window rather than by the bridge.
 */
export default function About() {
	return (
		<div style={{ display: "grid", gap: 10 }}>
			<h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "0.02em" }}>
				about {"{{name_text}}"}
			</h1>
			<p style={{ margin: 0, color: "GrayText" }}>
				A second static route. Navigating here from the start page is client-side, so a
				working app changes pages without reloading the window.
			</p>
			<Link href="/" style={{ fontSize: 13 }}>
				← back
			</Link>
		</div>
	);
}
