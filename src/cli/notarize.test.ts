import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "@/packaging/exec";
import { notarizeCommand } from "./notarize";

const KEYS = [
	"CRUST_SIGNING_IDENTITY",
	"CRUST_NOTARY_PROFILE",
	"CRUST_NOTARY_APPLE_ID",
	"CRUST_NOTARY_PASSWORD",
	"CRUST_NOTARY_TEAM_ID",
] as const;

type Env = Partial<Record<(typeof KEYS)[number], string>>;

/** The five credential variables are the command's whole input, so each test sets them from scratch. */
async function withEnv(values: Env, body: () => Promise<void>): Promise<void> {
	const saved = KEYS.map((key) => [key, process.env[key]] as const);
	for (const key of KEYS) delete process.env[key];
	Object.assign(process.env, values);
	try {
		await body();
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

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

describe("crust notarize", () => {
	test("refuses an ad-hoc identity before reading the bundle or running a command", async () => {
		const root = await project(false);
		try {
			await withEnv({}, async () => {
				const calls: string[][] = [];
				const { code, out } = await capture(() =>
					notarizeCommand({ dir: root }, { exec: recorder(calls) }),
				);
				expect(code).toBe(1);
				expect(out).toContain(
					"notarize refused   ad-hoc identity cannot be notarized — requires a Developer ID Application certificate",
				);
				expect(calls).toEqual([]);
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses a Developer ID signature with no notarytool credential", async () => {
		const root = await project(false);
		try {
			await withEnv(
				{ CRUST_SIGNING_IDENTITY: "Developer ID Application: Crust (ABCDE12345)" },
				async () => {
					const calls: string[][] = [];
					const { code, out } = await capture(() =>
						notarizeCommand({ dir: root }, { exec: recorder(calls) }),
					);
					expect(code).toBe(1);
					expect(out).toContain(
						"requires notarytool store-credentials <profile> or appleId + password",
					);
					expect(calls).toEqual([]);
				},
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("runs the plan and prints the accepted verdict", async () => {
		const root = await project(true);
		try {
			await withEnv(
				{
					CRUST_SIGNING_IDENTITY: "Developer ID Application: Crust (ABCDE12345)",
					CRUST_NOTARY_PROFILE: "crust",
				},
				async () => {
					const calls: string[][] = [];
					const { code, out } = await capture(() =>
						notarizeCommand({ dir: root }, { exec: recorder(calls) }),
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
				},
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
