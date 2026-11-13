import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// The window loads the Vite dev server; `crust/vite` gives that page the
	// same window.crust client the bridge serves into its own documents.
	dev: { url: "http://localhost:5173", beforeDevCommand: "bun --bun ./node_modules/.bin/vite" },
	windows: [{ label: "main", url: "/", width: 980, height: 700, title: "{{name_text}}" }],
	build: {
		// `bun x vite build` writes here (vite.config.ts `build.outDir`), and
		// `crust build` embeds this directory instead of public/.
		assets: "dist/web",
		beforeBuildCommand: "bun --bun ./node_modules/.bin/vite build",
	},
} satisfies CrustConfig;
