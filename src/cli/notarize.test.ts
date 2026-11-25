import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "@/packaging/exec";
import { notarizeStage } from "./notarize";

async function project(bundle: boolean): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "crust-cli-notarize-"));
	await writeFile(
		join(root, "crust.json"),
		JSON.stringify({
			app: { id: "land.jyz.example", name: "Example", version: "0.1.0" },
			windows: [{ label: "main" }],
		}),
		"utf8",
	);
	if (bundle) await mkdir(join(root, "dist", "Example.app"), { recursive: true });
	return root;
}

const appPath = (root: string): string => join(root, "dist", "Example.app");

function recorder(calls: string[][]): (command: string[]) => Promise<RunResult> {
	return async (command) => {
		calls.push(command);
		const accepted = command[1] === "notarytool" && command[2] === "submit";
		return {
			code: 0,
			stdout: accepted ? JSON.stringify({ id: "sub-1", status: "Accepted" }) : "",
			stderr: "",
		};
	};
}

async function capture(body: () => Promise<number>): Promise<{ code: number; out: string }> {
	const lines: string[] = [];
	const log = console.log;
	console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
	try {
		return { code: await body(), out: lines.join("\n") };
	} finally {
		console.log = log;
	}
}

describe("crust build --notarize stage", () => {
	test("refuses an ad-hoc identity before reading the bundle or running a command", async () => {
		const root = await project(false);
		try {
			const calls: string[][] = [];
			const { code, out } = await capture(() =>
				notarizeStage(appPath(root), {}, recorder(calls)),
			);
			expect(code).toBe(1);
			expect(out).toContain(
				"notarize refused   ad-hoc identity cannot be notarized — requires a Developer ID Application certificate",
			);
			expect(calls).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses a Developer ID signature with no notarytool credential", async () => {
		const root = await project(false);
		try {
			const calls: string[][] = [];
			const { code, out } = await capture(() =>
				notarizeStage(
					appPath(root),
					{ CRUST_SIGNING_IDENTITY: "Developer ID Application: Crust (ABCDE12345)" },
					recorder(calls),
				),
			);
			expect(code).toBe(1);
			expect(out).toContain(
				"requires notarytool store-credentials <profile> or appleId + password",
			);
			expect(calls).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("runs the plan and prints the accepted verdict", async () => {
		const root = await project(true);
		try {
			const calls: string[][] = [];
			const { code, out } = await capture(() =>
				notarizeStage(
					appPath(root),
					{
						CRUST_SIGNING_IDENTITY: "Developer ID Application: Crust (ABCDE12345)",
						CRUST_NOTARY_PROFILE: "crust",
					},
					recorder(calls),
				),
			);
			expect(code).toBe(0);
			expect(out).toContain("notarize accepted");
			expect(calls.map((command) => command[0])).toEqual([
				"ditto",
				"xcrun",
				"xcrun",
				"xcrun",
				"spctl",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed staple prints the step, its exit code and the tool log", async () => {
		const root = await project(true);
		try {
			const exec = async (command: string[]): Promise<RunResult> => {
				if (command[1] === "notarytool" && command[2] === "submit") {
					return {
						code: 0,
						stdout: JSON.stringify({ id: "sub-1", status: "Accepted" }),
						stderr: "",
					};
				}
				if (command[1] === "stapler" && command[2] === "staple") {
					return { code: 17, stdout: "", stderr: "stapler: ticket not found" };
				}
				return { code: 0, stdout: "", stderr: "" };
			};
			const { code, out } = await capture(() =>
				notarizeStage(
					appPath(root),
					{
						CRUST_SIGNING_IDENTITY: "Developer ID Application: Crust (ABCDE12345)",
						CRUST_NOTARY_PROFILE: "crust",
					},
					exec,
				),
			);
			expect(code).toBe(1);
			expect(out).toContain("notarize rejected");
			expect(out).toContain("staple failed (exit 17)");
			expect(out).toContain("stapler: ticket not found");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
