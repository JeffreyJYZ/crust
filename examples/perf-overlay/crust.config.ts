import type { CrustConfig } from "crust";

// Bridge-served plain HTML: no Vite, no bundler in dev. The overlay is a dev-only page module;
// the production page imports workload.js alone (see build.ts).
export default {
	app: { id: "land.jyz.perf-overlay", name: "Perf overlay probe", version: "0.1.0" },
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Perf overlay probe" }],
	testing: { activation: "none" },
} satisfies CrustConfig;
