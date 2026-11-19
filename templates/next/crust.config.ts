import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// `next dev` owns the page; the port is pinned because the bridge allows
	// exactly the origin `dev.url` names.
	dev: {
		url: "http://localhost:3000",
		beforeDevCommand: "bun --bun ./node_modules/.bin/next dev -p 3000",
	},
	windows: [{ label: "main", url: "/", width: 1100, height: 760, title: "{{name_text}}" }],
	// The page calls `invoke("greet", …)`, authorised as `app:greet` — the command, not the
	// `app:invoke` wire key. Declaring any capability turns the bridge deny-by-default, so this
	// grant names the one command the page uses: a new command needs its own action here, or
	// `app:invoke` if you deliberately want the broad alias.
	security: {
		capabilities: [{ name: "app", actions: ["app:greet"] }],
		grants: { main: ["app"] },
	},
	build: {
		// `crust build` runs `next build` first, which writes the export to out/,
		// then embeds that directory instead of public/.
		assets: "out",
		beforeBuildCommand: "bun --bun ./node_modules/.bin/next build",
	},
} satisfies CrustConfig;
