/**
 * The win-arm asset is one this machine cannot execute, so the verifier must prove it by
 * container and say plainly that it did not run. These tests build a stand-in PE on disk —
 * no Windows runner needed — and drive the same `checkAsset` the release verifier uses.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAsset, type Gap } from "./assets.ts";
import { artifactName, type Target } from "./targets.ts";

const HOST: Target = "bun-darwin-arm64";
const TARGET: Target = "bun-windows-arm64";
let dir: string | undefined;

async function workspace(): Promise<string> {
	dir ??= await mkdtemp(join(tmpdir(), "crust-arm-asset-"));
	return dir;
}

/** A plausible win-arm PE: MZ header, over the size floor, named as the sixth asset. */
async function writeArmAsset(): Promise<string> {
	const path = join(await workspace(), artifactName(TARGET));
	const bytes = new Uint8Array(1_000_001);
	bytes[0] = 0x4d; // M
	bytes[1] = 0x5a; // Z
	await Bun.write(path, bytes);
	return path;
}

afterEach(async () => {
	if (dir !== undefined) await rm(dir, { recursive: true, force: true });
	dir = undefined;
});

describe("the sixth (win-arm) asset", () => {
	test("a missing asset is an absent gap, so the release fails without it", async () => {
		const result = await checkAsset(TARGET, await workspace(), HOST);
		expect(result.gaps.some((gap: Gap) => gap.what === "absent")).toBe(true);
	});

	test("a PE asset passes by magic and reports not executed on a non-arm host", async () => {
		await writeArmAsset();
		const result = await checkAsset(TARGET, await workspace(), HOST);
		expect(result.gaps).toEqual([]);
		expect(result.lines.join("\n")).toContain(
			`not executed (${TARGET} on ${HOST})`,
		);
		expect(result.lines.join("\n")).toContain("4d5a");
	});
});
