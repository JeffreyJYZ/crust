import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "{{name_text}}",
};

// `colorScheme: "dark light"` is the whole theme: dark is the first preference,
// the system flips it to light, and Canvas/CanvasText follow it in both. No
// stylesheet, and nothing to read the media query.
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" style={{ colorScheme: "dark light" }}>
			<body
				style={{
					margin: 0,
					minHeight: "100vh",
					display: "grid",
					placeItems: "center",
					padding: 28,
					textAlign: "center",
					background: "Canvas",
					color: "CanvasText",
					font: "14px/1.5 ui-monospace, SFMono-Regular, monospace",
				}}
			>
				{children}
			</body>
		</html>
	);
}
