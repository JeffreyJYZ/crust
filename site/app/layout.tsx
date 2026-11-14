import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: { default: "crust", template: "%s · crust" },
	description: "macOS desktop apps from Bun and the system WKWebView. No Rust, no Chromium.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
