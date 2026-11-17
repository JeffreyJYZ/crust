import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAppImage, describeAppImage, type Exec } from "./appimage";

const ID = "land.jyz.example";
const NAME = "Example";
const BINARY = "example";
/** Enough of a PNG header that nothing here pretends to decode it. */
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

const OPTIONS = {
	appPath: "",
	binaryName: BINARY,
	id: ID,
	name: NAME,
	version: "0.1.0",
	iconPath: "",
};

/** A built bundle: one binary and one icon, in a temp dir removed by the caller. */
async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "crust-appimage-"));
	await mkdir(join(root, "dist"), { recursive: true });
	await writeFile(join(root, "dist", BINARY), "#!/bin/sh\necho example\n");
	await writeFile(join(root, "icon.png"), PNG);
	return root;
}

/** `which` answers with a path; the packer writes its output so `stat` sees a file. */
function fakeExec(calls: string[][], hasTool: boolean): Exec {
	return async (command) => {
		calls.push(command);
		if (command[0] === "which") {
			return hasTool
				? { code: 0, stdout: `/usr/bin/${command[1]}\n`, stderr: "" }
				: { code: 1, stdout: "", stderr: "" };
		}
		const out = command[command.length - 1];
		if (out !== undefined) await writeFile(out, "appimage");
		return { code: 0, stdout: "", stderr: "" };
	};
}

describe("buildAppImage", () => {
	test("creates the AppDir tree and packs it", async () => {
		const root = await fixture();
		try {
			const calls: string[][] = [];
			const result = await buildAppImage({
				...OPTIONS,
				appPath: join(root, "dist"),
				iconPath: join(root, "icon.png"),
				exec: fakeExec(calls, true),
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.reason);

			const appDir = join(root, "dist", `${ID}.AppDir`);
			expect(result.appDir).toBe(appDir);
			expect(result.path).toBe(join(root, "dist", `${ID}-0.1.0.AppImage`));
			expect(result.bytes).toBe("appimage".length);
			expect(result.tool).toBe("appimagetool");

			const appRun = join(appDir, "AppRun");
			expect(await readFile(appRun, "utf8")).toBe(
				`#!/bin/sh\nexec "$(dirname "$0")/usr/bin/${BINARY}" "$@"\n`,
			);
			expect((await stat(appRun)).mode & 0o111).not.toBe(0);

			const installed = join(appDir, "usr", "bin", BINARY);
			expect(await readFile(installed, "utf8")).toContain("echo example");
			expect((await stat(installed)).mode & 0o111).not.toBe(0);

			const desktop = join(appDir, "usr", "share", "applications", `${ID}.desktop`);
			expect(await readFile(desktop, "utf8")).toBe(
				[
					"[Desktop Entry]",
					"Type=Application",
					`Name=${NAME}`,
					`Exec=${BINARY}`,
					`Icon=${ID}`,
					"Categories=Utility;",
					"Terminal=false",
					"",
				].join("\n"),
			);
			expect(await readlink(join(appDir, `${ID}.desktop`))).toBe(
				`usr/share/applications/${ID}.desktop`,
			);

			const icon = join(appDir, "usr", "share", "icons", "hicolor", "512x512", "apps");
			expect((await stat(join(icon, `${ID}.png`))).size).toBe(PNG.length);
			// appimagetool treats the root `<Icon>.png` and `.DirIcon` as critical:
			// without them the image has no thumbnail and a future tool refuses it.
			expect((await stat(join(appDir, `${ID}.png`))).size).toBe(PNG.length);
			expect((await stat(join(appDir, ".DirIcon"))).size).toBe(PNG.length);

			expect(
				calls.some(
					(command) => command.includes("--no-appstream") && command.includes(appDir),
				),
			).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("reports the missing tool honestly and keeps the AppDir", async () => {
		const root = await fixture();
		try {
			const calls: string[][] = [];
			const result = await buildAppImage({
				...OPTIONS,
				appPath: join(root, "dist"),
				iconPath: join(root, "icon.png"),
				exec: fakeExec(calls, false),
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected the tool to be missing");
			expect(result.reason).toBe("appimagetool is not on PATH");
			expect(result.requires).toBe("appimagetool");
			expect(calls.length).toBe(1);
			expect(describeAppImage(result)).toContain("install appimagetool");

			expect((await stat(join(result.appDir, "AppRun"))).isFile()).toBe(true);
			expect(
				await stat(join(root, "dist", `${ID}-0.1.0.AppImage`)).catch(() => undefined),
			).toBe(undefined);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
