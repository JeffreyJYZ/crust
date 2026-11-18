/**
 * A thin async wrapper over agent-browser. Async is load-bearing: the bridge
 * shares this process's event loop, so a synchronous spawn deadlocks the page's
 * invoke while the CLI waits for it. Every call retries the daemon's startup
 * EAGAIN once it has settled, and the session is always closed by the caller.
 */
export const SESSION = `capability-${process.pid}`;

/** Run one agent-browser command in this e2e's private session; return stdout. */
export async function run(args: string[]): Promise<string> {
	let last = "";
	for (let attempt = 0; attempt < 8; attempt++) {
		const child = Bun.spawn({
			cmd: ["agent-browser", "--session", SESSION, ...args],
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		last = `${stdout}${stderr}`.trim();
		if (!last.includes("Resource temporarily unavailable")) return stdout.trim();
		await Bun.sleep(250);
	}
	return last;
}

/** Close only this session, never another agent's. */
export async function close(): Promise<void> {
	await run(["close"]);
}
