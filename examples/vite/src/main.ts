/**
 * The backend: one app command, then the window.
 *
 * Run it with `bun run src/cli/index.ts dev --dir examples/vite`. `crust`
 * resolves through this package's own `exports` map, so the example needs no
 * install; a project using the published package writes the same import.
 */
import { app } from "crust";

app.command("greet", ({ name }) => {
	const who = typeof name === "string" && name.length > 0 ? name : "there";
	const answer = `hello ${who}, from crust through Vite`;
	console.log(`  greet     ${answer} (page call answered)`);
	return answer;
});

await app.run();
