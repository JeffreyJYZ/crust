import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { pumpText, runCommand } from "./command.ts";

function chunks(values: number[][]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const value of values) controller.enqueue(new Uint8Array(value));
			controller.close();
		},
	});
}

describe("stream text decoding", () => {
	test("stdout and stderr hold independent streaming decoder state", async () => {
		let out = "";
		let err = "";
		await Promise.all([
			pumpText(chunks([[0xc3], [0xa9]]), (text) => {
				out += text;
			}),
			pumpText(chunks([[0x58]]), (text) => {
				err += text;
			}),
		]);
		expect(out).toBe("é");
		expect(err).toBe("X");
	});
});

describe("runCommand deadlines", () => {
	test("a child that exits leaves no timer holding the process open", async () => {
		// The child must exit naturally, not through process.exit: the point is whether its
		// timer backlog lets the event loop drain after runCommand resolves.
		const modulePath = fileURLToPath(new URL("./command.ts", import.meta.url));
		const probe = [
			`import { runCommand } from ${JSON.stringify(modulePath)};`,
			"const result = await runCommand(['true'], process.cwd());",
			"console.log(JSON.stringify(result));",
		].join("\n");
		const child = Bun.spawn([process.execPath, "-e", probe], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const started = Date.now();
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		const elapsed = Date.now() - started;
		expect(code).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({ code: 0, ended: "exit" });
		// Before the timers were cancelled the process stayed up for ~530 ms after a 2 ms run.
		expect(elapsed).toBeLessThan(300);
		expect(stderr).toBe("");
	}, 10000);
});
