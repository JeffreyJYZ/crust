import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.vite-example", name: "crust vite example", version: "0.1.0" },
	// The frontend is a real Vite app: the window loads the dev server, and
	// `crust/vite` puts the page client in the document Vite serves.
	dev: {
		url: "http://localhost:5173",
		beforeDevCommand: "bun x vite",
	},
	windows: [{ label: "main", width: 720, height: 480, title: "crust + Vite" }],
} satisfies CrustConfig;
