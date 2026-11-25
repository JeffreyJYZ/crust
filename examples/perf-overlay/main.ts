/**
 * The probe app: one real `perf` plugin, one window, no other work. The page owns the frame
 * numbers; this half only answers `invoke("perf", ...)` for the overlay's seam adapter.
 */
import { app } from "crust";
import { createPerfPlugin } from "../../src/plugins/perf.ts";

app.use(createPerfPlugin());
app.on("window-all-closed", () => {
	console.log("  window    closed; quitting");
});
await app.run();
