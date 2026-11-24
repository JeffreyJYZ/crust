import type { CrustConfig } from "crust";

/**
 * Probe app for the baseline performance wave. `testing.activation: "none"` means
 * launch and capture never take the human's frontmost app. The only capabilities
 * are the ones the probe uses: its own plugin and `window.capture`.
 */
export default {
	app: { id: "land.jyz.perfprobe", name: "Perf probe", version: "0.1.0" },
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Perf probe" }],
	testing: { activation: "none" },
	logging: { console: true },
	security: {
		capabilities: [
			{ name: "perf", actions: ["perf:*"] },
			{ name: "window", actions: ["window:capture"] },
		],
		grants: { main: ["perf", "window"] },
	},
} satisfies CrustConfig;
