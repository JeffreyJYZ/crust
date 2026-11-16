import type { CrustConfig } from "crust";

/**
 * Two windows, one page. Each entry opens the same `index.html` with the label it
 * was created under in the query string, because `crust:window` has no command
 * that answers "which window am I" — see the README's gaps section.
 */
export default {
	app: { id: "land.jyz.multi-window", name: "Multi-window", version: "0.1.0" },
	windows: [
		{
			label: "main",
			url: "/?window=main",
			width: 760,
			height: 520,
			title: "Multi-window — main",
		},
		{
			label: "inspector",
			url: "/?window=inspector",
			width: 420,
			height: 300,
			title: "Multi-window — inspector",
		},
	],
} satisfies CrustConfig;
