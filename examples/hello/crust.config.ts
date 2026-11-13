import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.hello", name: "Hello crust", version: "0.1.0" },
	// No dev.url: the bridge serves public/index.html itself, so `crust dev`
	// needs no Vite, no bundler, and no build step for the frontend.
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Hello crust" }],
} satisfies CrustConfig;
