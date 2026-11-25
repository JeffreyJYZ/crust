import { describe, expect, test } from "bun:test";
import type { CrustConfig } from "@/config";
import { hasStages, runStages, stageRefusal } from "./stages";

const IDENTITY = "Developer ID Application: Crust (ABCDE12345)";
const FULL_ENV = { CRUST_SIGNING_IDENTITY: IDENTITY, CRUST_NOTARY_PROFILE: "crust" };
const CONFIG = {
	app: { id: "land.jyz.example", name: "Example", version: "0.1.0" },
	windows: [{ label: "main" }],
} as CrustConfig;

describe("build stage refusals", () => {
	test("notarize without sign names what is missing", () => {
		expect(stageRefusal({ dir: "/p", notarize: true }, { env: {} })).toContain(
			"notarize requires --sign",
		);
	});

	test("dmg on a platform with no disk image names the platform", () => {
		expect(
			stageRefusal({ dir: "/p", dmg: true }, { platform: "linux", env: FULL_ENV }),
		).toContain("--dmg has no disk image on linux");
	});

	test("sign with no identity names the environment variable", () => {
		expect(stageRefusal({ dir: "/p", sign: true }, { env: {} })).toContain(
			"sign requires CRUST_SIGNING_IDENTITY",
		);
	});

	test("notarize with no credential names the two credential routes", () => {
		const refusal = stageRefusal(
			{ dir: "/p", sign: true, notarize: true },
			{ env: { CRUST_SIGNING_IDENTITY: IDENTITY } },
		);
		expect(refusal).toContain("notarize requires notarytool credentials");
		expect(refusal).toContain("appleId + password");
	});

	test("the full chain is accepted on macOS with credentials", () => {
		expect(
			stageRefusal(
				{ dir: "/p", sign: true, notarize: true, dmg: true },
				{ platform: "darwin", env: FULL_ENV },
			),
		).toBeUndefined();
	});
});

describe("stage order", () => {
	test("sign, then notarize and staple, then build the dmg from the stapled app", async () => {
		const calls: string[] = [];
		const code = await runStages(
			"/p/dist/Example.app",
			{ dir: "/p", sign: true, notarize: true, dmg: true },
			CONFIG,
			{
				platform: "darwin",
				env: FULL_ENV,
				sign: async () => {
					calls.push("sign");
					return 0;
				},
				notarize: async () => {
					calls.push("notarize");
					return 0;
				},
				dmg: async (options) => {
					calls.push(options.out?.endsWith(".dmg") ? "dmg" : "bad-dmg");
					return 0;
				},
			},
		);
		expect(calls).toEqual(["sign", "notarize", "dmg"]);
		expect(code).toBe(0);
	});

	test("passes the declared sidecars to the sign stage", async () => {
		let sidecars: readonly string[] | undefined;
		await runStages(
			"/p/dist/Example.app",
			{ dir: "/p", sign: true },
			{ ...CONFIG, build: { sidecars: ["bin/tool.sh", "tools/helper"] } },
			{
				env: FULL_ENV,
				sign: async (_bundle, _identity, _microphone, names) => {
					sidecars = names;
					return 0;
				},
			},
		);
		expect(sidecars).toEqual(["bin/tool.sh", "tools/helper"]);
	});

	test("a failed stage stops the chain and returns its exit code", async () => {
		const calls: string[] = [];
		const code = await runStages(
			"/p/dist/Example.app",
			{ dir: "/p", sign: true, notarize: true, dmg: true },
			CONFIG,
			{
				env: FULL_ENV,
				sign: async () => {
					calls.push("sign");
					return 7;
				},
				notarize: async () => {
					calls.push("notarize");
					return 0;
				},
				dmg: async () => {
					calls.push("dmg");
					return 0;
				},
			},
		);
		expect(calls).toEqual(["sign"]);
		expect(code).toBe(7);
	});

	test("hasStages is false for the plain build", () => {
		expect(hasStages({ dir: "/p" })).toBe(false);
		expect(hasStages({ dir: "/p", dmg: true })).toBe(true);
	});
});
