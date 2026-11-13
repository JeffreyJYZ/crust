import { defineConfig } from "vite";
import { crust } from "crust/vite";

export default defineConfig({
	// The bridge allows exactly the origin `dev.url` names, so the port is
	// pinned instead of letting Vite move to the next free one.
	server: { port: 5173, strictPort: true },
	plugins: [crust()],
});
