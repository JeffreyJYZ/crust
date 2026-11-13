/**
 * The smallest crust app: one app command, one plugin of its own, one window.
 *
 * Run it with `bun run src/cli/index.ts dev --dir examples/hello` from the repo
 * root. `crust` resolves through this package's own `exports` map, so the
 * example needs no install; a project using the published package writes the
 * same import.
 */
import { app } from "crust";
import { definePlugin } from "crust/plugin";

/**
 * A plugin the project owns, not the framework. `app.use` mounts it before
 * `run()` creates the bridge, so the page reaches it as
 * `invoke("greeting", "greet", { name })` — the three-argument plugin form.
 */
const greeting = definePlugin({
	name: "greeting",
	commands: {
		greet: ({ name }: { name?: string }) => {
			const who = typeof name === "string" && name.length > 0 ? name : "there";
			const answer = `hello ${who}, from a plugin`;
			console.log(`  plugin    greeting.greet answered: ${answer}`);
			return answer;
		},
	},
});

app.use(greeting);

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
