/**
 * The smallest crust app: one command, one window.
 *
 * Run it with `bun run src/cli/index.ts dev --dir examples/hello` from the repo
 * root. `crust` resolves through this package's own `exports` map, so the
 * example needs no install; a project using the published package writes the
 * same import.
 */
import { app } from "crust";

app.command("greet", ({ name }) => {
	const answer = `hello ${typeof name === "string" && name.length > 0 ? name : "there"}`;
	console.log(`  greet     ${answer} (page call answered)`);
	return answer;
});

app.on("ready", () => {
	console.log("  window    Hello crust is open — 900x640");
});

// Closing the window ends the app instead of leaving the pump running.
app.on("window-all-closed", () => {
	console.log("  window    closed; quitting");
});

await app.run();
