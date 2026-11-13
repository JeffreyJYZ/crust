import react from "@vitejs/plugin-react";
import { crust } from "crust/vite";
import { defineConfig } from "vite";

export default defineConfig({
	// Pin the port: the bridge allows exactly the origin `dev.url` names in
	// crust.config.ts, so Vite must not move to the next free one.
	server: { port: 5173, strictPort: true },
	// `crust()` puts window.crust into the document Vite serves; the react plugin
	// is the JSX transform. Serve-only, so the built page ships no token.
	plugins: [react(), crust()],
	build: {
		// `crust build` writes its own output into dist/, so the web build gets a
		// directory of its own. `build.assets` in crust.config.ts points here.
		outDir: "dist/web",
		emptyOutDir: true,
	},
});
