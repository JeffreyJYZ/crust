import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.dogear", name: "Dogear", version: "0.1.0" },
	// The window loads Vite in dev and the embedded build in a bundle. The port
	// is pinned because the bridge allows exactly the origin `dev.url` names.
	dev: {
		url: "http://localhost:5173",
		beforeDevCommand: "bun --bun ./node_modules/.bin/vite",
	},
	// A note's path is absolute, so the window needs no base URL of its own.
	windows: [{ label: "main", url: "/", width: 1040, height: 720, title: "Dogear" }],
	build: {
		// `crust build` writes into dist/ as well, so the web build gets a
		// directory of its own and a second build cannot embed its own binary.
		assets: "dist/web",
		beforeBuildCommand: "bun --bun ./node_modules/.bin/vite build",
	},
} satisfies CrustConfig;
