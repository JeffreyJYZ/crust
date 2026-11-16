import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.native", name: "Native", version: "0.1.0" },
	// Two extensions, one per language. Both are named here rather than discovered, because the
	// generated bindings module and its dylib live in `extensions/generated/` — a directory the
	// loader would otherwise pick up on its own, and the dylibs are not `*.ts`.
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Native" }],
	extensions: ["extensions/zigclock.ts", "extensions/rustclock.ts"],
} satisfies CrustConfig;
