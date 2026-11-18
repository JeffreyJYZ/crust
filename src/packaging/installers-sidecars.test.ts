import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIDECAR_MANIFEST } from "@/plugins/sidecar";
import { buildAppImage, type Exec } from "./appimage";
import { buildNsis } from "./nsis";

/** The defect: installers packaged only the flat binary, so a built app's sidecars vanished. */
const roots: string[] = [];
const ID = "land.jyz.installer";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A macOS-shaped build: sidecar files in Contents/MacOS, manifest in Contents/Resources. */
async function fixture(binary: string): Promise<{ root: string; dist: string }> {
	const root = await mkdtemp(join(tmpdir(), "crust-installer-sidecar-"));
	roots.push(root);
	const dist = join(root, "dist");
	const contents = join(dist, "Example.app", "Contents");
	const macos = join(contents, "MacOS");
	await mkdir(join(macos, "bin"), { recursive: true });
	await mkdir(join(contents, "Resources"), { recursive: true });
	await writeFile(join(dist, binary), "binary\n", "utf8");
	await writeFile(join(macos, binary), "binary\n", "utf8");
	await writeFile(join(macos, "bin", "tool.sh"), "#!/bin/sh\necho sidecar\n", {
		mode: 0o644,
	});
	await writeFile(
		join(contents, "Resources", SIDECAR_MANIFEST),
		JSON.stringify(["bin/tool.sh"]),
		"utf8",
	);
	await mkdir(join(root, "icon"), { recursive: true });
	await writeFile(join(root, "icon", "icon.png"), PNG);
	return { root, dist };
}

function fakeExec(): Exec {
	return async (command) => {
		if (command[0] === "which" || command[0] === "where") {
			return { code: 0, stdout: `/usr/bin/${command[1]}\n`, stderr: "" };
		}
		const out = command[command.length - 1];
		if (out !== undefined) await writeFile(out, "packed");
		return { code: 0, stdout: "", stderr: "" };
	};
}

describe("installers ship declared sidecars", () => {
	test("AppImage stages the file and the manifest beside its executable", async () => {
		const { root, dist } = await fixture("crust-app");
		const result = await buildAppImage({
			appPath: dist,
			binaryName: "crust-app",
			id: ID,
			name: "Example",
			version: "0.1.0",
			iconPath: join(root, "icon", "icon.png"),
			exec: fakeExec(),
		});
		expect(result.ok).toBe(true);
		const bin = join(dist, `${ID}.AppDir`, "usr", "bin");
		expect(await readFile(join(bin, "bin", "tool.sh"), "utf8")).toContain("echo sidecar");
		expect((await stat(join(bin, "bin", "tool.sh"))).mode & 0o777).toBe(0o755);
		expect(JSON.parse(await readFile(join(bin, SIDECAR_MANIFEST), "utf8"))).toEqual([
			"bin/tool.sh",
		]);
	});

	test("NSIS stages the file and names it with its relative path in the script", async () => {
		const { dist } = await fixture("crust-app.exe");
		// makensis takes the script, not the output path: read `OutFile` so the builder's
		// post-pack `stat` sees the artefact a real compiler would have written.
		const nsisExec: Exec = async (command) => {
			if (command[0] === "which" || command[0] === "where") {
				return { code: 0, stdout: "/usr/bin/makensis\n", stderr: "" };
			}
			const script = await readFile(command[1] ?? "", "utf8");
			const out = script.match(/^OutFile "(.+)"$/m)?.[1];
			if (out === undefined) throw new Error("no OutFile in generated script");
			await writeFile(out, "packed");
			return { code: 0, stdout: "", stderr: "" };
		};
		const result = await buildNsis({
			appPath: dist,
			binaryName: "crust-app.exe",
			id: ID,
			name: "Example",
			version: "0.1.0",
			exec: nsisExec,
		});
		expect(result.ok).toBe(true);
		expect(await readFile(join(dist, "bin", "tool.sh"), "utf8")).toContain("echo sidecar");
		const script = await readFile(join(dist, `${ID}.nsi`), "utf8");
		expect(script).toContain(`  File /oname=bin\\tool.sh "${join(dist, "bin", "tool.sh")}"`);
		expect(script).toContain(`  File "${join(dist, SIDECAR_MANIFEST)}"`);
	});
});
