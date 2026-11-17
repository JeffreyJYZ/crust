import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// The window loads the Vite dev server; `crust/vite` gives that page the
	// same window.crust client the bridge serves into its own documents.
	dev: { url: "http://localhost:5173", beforeDevCommand: "bun --bun ./node_modules/.bin/vite" },
	windows: [{ label: "main", url: "/", width: 980, height: 700, title: "{{name_text}}" }],
	// The Svelte page calls `invoke("greet", …)`, which travels over the bridge as `app:invoke` and
	// is gated like every other action. Declaring any capability turns the bridge deny-by-default,
	// so this grant names the one action the page actually uses — widen it when the app calls plugins.
	security: {
		capabilities: [{ name: "app", actions: ["app:invoke"] }],
		grants: { main: ["app"] },
	},
	build: {
		// `bun x vite build` writes here (vite.config.ts `build.outDir`), and
		// `crust build` embeds this directory instead of public/.
		assets: "dist/web",
		beforeBuildCommand: "bun --bun ./node_modules/.bin/vite build",
	},
} satisfies CrustConfig;
