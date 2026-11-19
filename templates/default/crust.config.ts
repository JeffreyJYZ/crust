import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// No dev.url: the bridge serves public/ itself, so `crust dev` works with no
	// Vite, no bundler, and no frontend build step.
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "{{name_text}}" }],
	// The page calls `invoke("greet", …)`, authorised as `app:greet` — the command, not the
	// `app:invoke` wire key. Declaring any capability turns the bridge deny-by-default, so this
	// grant names the one command the page uses: a new command needs its own action here, or
	// `app:invoke` if you deliberately want the broad alias.
	security: {
		capabilities: [{ name: "app", actions: ["app:greet"] }],
		grants: { main: ["app"] },
	},
} satisfies CrustConfig;
