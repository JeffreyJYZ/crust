import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// No dev.url: the bridge serves public/ itself, so `crust dev` works with no
	// Vite, no bundler, and no frontend build step.
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "{{name_text}}" }],
	// The page calls `invoke("greet", …)`, which travels over the bridge as `app:invoke` and is
	// gated like every other action. Declaring any capability turns the bridge deny-by-default, so
	// this grant names the one action the page actually uses — widen it when the app calls plugins.
	security: {
		capabilities: [{ name: "app", actions: ["app:invoke"] }],
		grants: { main: ["app"] },
	},
} satisfies CrustConfig;
