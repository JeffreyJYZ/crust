/**
 * The media-capture proof's two sources, kept out of the harness so `e2e-media.ts` stays under the
 * line cap. The page answers in stages, which is what separates the three findings: `mediaDevices`
 * missing, a request that is decided immediately (granted or refused), and a request still pending
 * because macOS is showing its TCC prompt and no person has answered it.
 */
export const page = `<!doctype html>
<title>media e2e</title>
<p>media e2e
<script type="module">
	const wait = setInterval(async () => {
		if (!window.crust) return;
		clearInterval(wait);
		const media = navigator.mediaDevices;
		await window.crust.invoke("report", {
			text: media && typeof media.getUserMedia === "function"
				? "mediaDevices present"
				: "mediaDevices MISSING",
		});
		await window.crust.invoke("report", { text: "request started" });
		let text;
		try {
			const stream = await media.getUserMedia({ audio: true });
			const tracks = stream.getAudioTracks();
			text = \`getUserMedia granted — \${tracks.length} audio track (\${tracks[0] ? tracks[0].label : "unlabelled"})\`;
			for (const track of tracks) track.stop();
		} catch (error) {
			text = \`getUserMedia refused — \${error && error.name ? error.name : "error"}: \${error && error.message ? error.message : String(error)}\`;
		}
		await window.crust.invoke("report", { text, quit: true });
	}, 100);
</script>
`;

export const entry = `import { app } from "crust";

app.command("report", ({ text, quit }) => {
	console.log(\`  page      \${typeof text === "string" ? text : JSON.stringify(text)}\`);
	// The person's TCC answer has no timeout of its own, so the run ends on the app's terms: the
	// final line is the only one that quits, and a run with no answer is the harness deadline.
	if (quit === true) setTimeout(() => app.quit(), 100);
	return { ok: true };
});

await app.run();
`;
