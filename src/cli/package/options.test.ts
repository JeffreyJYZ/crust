import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import type { CrustConfig } from "@/config";
import {
	BINARY_NAME,
	appImageOptions,
	dmgOptions,
	nsisOptions,
	type PackageInputs,
} from "./options";

const DIR = "/projects/example";
const CONFIG: CrustConfig = {
	app: { id: "land.jyz.example", name: "Example", version: "1.2.3" },
	windows: [{ label: "main" }],
};

const INPUTS: PackageInputs = {
	dir: DIR,
	config: CONFIG,
	bundle: join(DIR, "dist", "Example.app"),
	dist: join(DIR, "dist"),
	iconPath: join(DIR, "icon.png"),
};

describe("package option builders", () => {
	test("dmg lands beside the bundle, under the configured name and version", () => {
		expect(dmgOptions(INPUTS)).toEqual({
			appPath: join(DIR, "dist", "Example.app"),
			out: resolve(DIR, "dist/Example-1.2.3.dmg"),
			volumeName: "Example",
		});
	});

	test("appimage packages the binary directory and carries the icon", () => {
		const exec = async () => ({ code: 0, stdout: "", stderr: "" });
		const options = appImageOptions(INPUTS, INPUTS.iconPath ?? "", exec);
		expect(options).toMatchObject({
			appPath: join(DIR, "dist"),
			binaryName: BINARY_NAME,
			id: "land.jyz.example",
			name: "Example",
			version: "1.2.3",
			iconPath: join(DIR, "icon.png"),
		});
		expect(options.exec).toBe(exec);
	});

	test("nsis names the installed executable with its .exe suffix", () => {
		const options = nsisOptions(INPUTS);
		expect(options).toMatchObject({
			appPath: join(DIR, "dist"),
			binaryName: `${BINARY_NAME}.exe`,
			id: "land.jyz.example",
			name: "Example",
			version: "1.2.3",
		});
		expect(options.sidecars).toBeUndefined();
	});

	test("nsis passes the declared build.sidecars through to the installer", () => {
		const sidecars = ["bin/tool.sh", "tools/helper"];
		const options = nsisOptions({ ...INPUTS, config: { ...CONFIG, build: { sidecars } } });
		expect(options.sidecars).toEqual(sidecars);
	});
});
