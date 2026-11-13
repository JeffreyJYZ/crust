import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.notes", name: "Notes", version: "0.1.0" },
	// No dev.url: the bridge serves public/index.html itself, so the frontend
	// needs no bundler and no build step. `crust:fs` is the only plugin the app
	// asks for; it provides readTextFile and writeTextFile.
	windows: [{ label: "main", url: "/", width: 1000, height: 700, title: "Notes" }],
	plugins: ["crust:fs"],
} satisfies CrustConfig;
