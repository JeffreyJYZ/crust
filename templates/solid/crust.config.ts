import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// The window loads the Vite dev server; `crust/vite` gives that page the
	// same window.crust client the bridge serves into its own documents.
	dev: { url: "http://localhost:5173", beforeDevCommand: "bun --bun ./node_modules/.bin/vite" },
	windows: [{ label: "main", url: "/", width: 980, height: 700, title: "{{name_text}}" }],
	// The Solid page calls `invoke("greet", …)`, authorised as `app:greet` — the command, not the
	// `app:invoke` wire key. Declaring any capability turns the bridge deny-by-default, so this
	// grant names the one command the page uses: a new command needs its own action here, or
	// `app:invoke` if you deliberately want the broad alias.
	security: {
		capabilities: [{ name: "app", actions: ["app:greet"] }],
		grants: { main: ["app"] },
	},
	build: {
		// `bun x vite build` writes here (vite.config.ts `build.outDir`), and
		// `crust build` embeds this directory instead of public/.
		assets: "dist/web",
		beforeBuildCommand: "bun --bun ./node_modules/.bin/vite build",
	},
} satisfies CrustConfig;
