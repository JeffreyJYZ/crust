/**
 * The notify proof's two sources, kept out of the harness so `e2e-notify.ts` stays under the line cap.
 * The page asks for a notification and reports the answer; the entry quits from inside the app, so a
 * run that never answers is a timeout rather than a hang.
 */
export const page = `<!doctype html>
<title>notify e2e</title>
<p>notify e2e
<script type="module">
	const wait = setInterval(async () => {
		if (!window.crust) return;
		clearInterval(wait);
		let text;
		try {
			const answer = await window.crust.invoke("notification", "notify", {
				title: "crust e2e",
				body: "delivery is asserted, not assumed",
				waitMs: 60000,
			});
			text = JSON.stringify(answer);
		} catch (error) {
			text = \`THREW \${error && error.message ? error.message : String(error)}\`;
		}
		await window.crust.invoke("report", { text });
	}, 100);
</script>
`;

export const entry = `import { app } from "crust";

app.command("report", ({ text }) => {
	console.log(\`  page      \${typeof text === "string" ? text : JSON.stringify(text)}\`);
	// Quit from the app rather than from the harness: the run then ends on the app's own
	// terms, and an app that never answers is a timeout rather than a hang.
	setTimeout(() => app.quit(), 100);
	return { ok: true };
});

await app.run();
`;
