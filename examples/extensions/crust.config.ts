import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.extensions", name: "Extensions", version: "0.1.0" },
	// One window, and one extension file. A relative entry resolves against this
	// project, so `extensions/clock.ts` and `clock.ts` name the same file; absent,
	// crust would discover every `*.ts` under `extensions/` instead.
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Extensions" }],
	extensions: ["extensions/clock.ts"],
} satisfies CrustConfig;
