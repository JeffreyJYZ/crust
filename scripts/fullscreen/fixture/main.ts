/**
 * The backend of the scratch app: the page's reporting channel, the live-window read it asks for,
 * and the line that proves the app ended itself. `nativeProbe` supplies the read.
 */
import { nativeProbe } from "./native.ts";

const BACKEND = `
app.command("report", (args) => {
	const line = typeof args.line === "string" ? args.line : "";
	console.log("  page      " + line);
	return "printed";
});

// The window number is taken from the launch read and passed back, so the same NSWindow is measured
// through both transitions rather than whatever happens to be first in AppKit's list.
app.command("probe", (args) => readWindow(Number(args && args.window) || 0));

app.on("window-all-closed", () => {
	console.log("  window    every window closed; quitting");
});

await app.run();
`;

export function mainSource(repoRoot: string): string {
	return `${nativeProbe(repoRoot)}\nimport { app } from "crust";\n${BACKEND}`;
}
