import type { CrustConfig } from "crust";

export default {
	app: { id: "app.crust.{{package}}", name: "{{name_text}}", version: "0.1.0" },
	// No dev.url: the bridge serves public/ itself, so `crust dev` works with no
	// Vite, no bundler, and no frontend build step.
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "{{name_text}}" }],
} satisfies CrustConfig;
