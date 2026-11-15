import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.parity-probe", name: "Parity probe", version: "0.1.0" },
	// Config validation needs one window, so the runtime opens a 1x1 shell that
	// nothing reads. The probe's own window is the one that is measured.
	windows: [{ label: "runtime", url: "/", width: 1, height: 1, title: "Parity probe" }],
} satisfies CrustConfig;
