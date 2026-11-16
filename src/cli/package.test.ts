import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "@/packaging/exec";
import { packageCommand } from "./package";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

/** A project as `crust build` leaves it: a config, a bundle, the binary, an icon. */
async function fixture(options: { icon?: boolean; bundle?: boolean } = {}): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "crust-cli-package-"));
	await writeFile(
		join(root, "crust.json"),
		JSON.stringify({
			app: {
				id: "land.jyz.example",
				name: "Example",
				version: "0.1.0",
				...(options.icon === false ? {} : { icon: "icon.png" }),
			},
			windows: [{ label: "main" }],
		}),
		"utf8",
	);
	if (options.icon !== false) await writeFile(join(root, "icon.png"), PNG);
	await mkdir(join(root, "dist"), { recursive: true });
	if (options.bundle !== false)
		await mkdir(join(root, "dist", "Example.app"), { recursive: true });
	await writeFile(join(root, "dist", "crust-app"), "#!/bin/sh\n");
	return root;
}

/** `which` answers nothing, so no packer is ever invoked. */
function missingTools(calls: string[][]): (command: string[]) => Promise<RunResult> {
	return async (command) => {
		calls.push(command);
		return { code: 1, stdout: "", stderr: "" };
	};
}

/** Both streams, so a `fail` line is visible to the assertion. */
async function capture(body: () => Promise<number>): Promise<{ code: number; out: string }> {
	const lines: string[] = [];
	const log = console.log;
	const error = console.error;
	console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
	console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
	try {
		return { code: await body(), out: lines.join("\n") };
	} finally {
		console.log = log;
		console.error = error;
	}
}

describe("crust package", () => {
	test("prints each missing tool's requires line and exits 1", async () => {
		const root = await fixture();
		try {
			const calls: string[][] = [];
			const { code, out } = await capture(() =>
				packageCommand(
					{ dir: root, formats: ["appimage", "nsis"] },
					{ exec: missingTools(calls) },
				),
			);
			expect(code).toBe(1);
			expect(out).toContain("install appimagetool");
			expect(out).toContain("install makensis");
			// Only the two `which` lookups: no packer ran.
			expect(calls.map((command) => command[0])).toEqual(["which", "which"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses an appimage when the config names no icon", async () => {
		const root = await fixture({ icon: false });
		try {
			const calls: string[][] = [];
			const { code, out } = await capture(() =>
				packageCommand({ dir: root, formats: ["appimage"] }, { exec: missingTools(calls) }),
			);
			expect(code).toBe(1);
			expect(out).toContain("app.icon is not set");
			expect(calls).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("says to build first when no .app exists", async () => {
		const root = await fixture({ bundle: false });
		try {
			const { code, out } = await capture(() =>
				packageCommand({ dir: root, formats: ["nsis"] }),
			);
			expect(code).toBe(1);
			expect(out).toContain("run crust build first");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
