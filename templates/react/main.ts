import { app } from "crust";

// One command is the whole backend: the React page calls it on mount, so a
// built app proves the window, the bridge and this handler in one line.
app.command("greet", ({ name }) => {
	const answer = `hello ${typeof name === "string" && name.length > 0 ? name : "there"}`;
	console.log(`  greet     ${answer} (page call answered)`);
	return answer;
});

app.on("ready", () => {
	console.log("  window    open");
});

// Closing the window ends the app instead of leaving the pump running.
app.on("window-all-closed", () => {
	console.log("  window    closed; quitting");
});

await app.run();
