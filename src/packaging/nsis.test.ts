import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNsis, describeNsis, type Exec } from "./nsis";

const ID = "land.jyz.example";
const NAME = "Example";
const BINARY = "example.exe";

const OPTIONS = {
	appPath: "",
	binaryName: BINARY,
	id: ID,
	name: NAME,
	version: "0.1.0",
};

/** The directives a script needs to install, shortcut, uninstall and register itself. */
const REQUIRED = [
	'!define APP_NAME "Example"',
	'!define APP_VERSION "0.1.0"',
	`!define APP_ID "${ID}"`,
	'OutFile "',
	`InstallDir "$LOCALAPPDATA\\Programs\\${NAME}"`,
	"RequestExecutionLevel user",
	"Page directory",
	"Page instfiles",
	'Section "Install"',
	'File "',
	'CreateShortcut "$SMPROGRAMS\\${APP_NAME}.lnk"',
	'WriteUninstaller "$INSTDIR\\Uninstall.exe"',
	'WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "DisplayName"',
	'WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" "DisplayName"',
	'Section "Uninstall"',
	'DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}"',
];

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "crust-nsis-"));
	await mkdir(join(root, "dist", "app"), { recursive: true });
	await writeFile(join(root, "dist", "app", BINARY), "MZ\n");
	return root;
}

/** `which` answers with a path; makensis writes its output so `stat` sees a file. */
function fakeExec(hasTool: boolean): Exec {
	return async (command) => {
		if (command[0] === "which" || command[0] === "where") {
			return hasTool
				? { code: 0, stdout: `/usr/bin/${command[1]}\n`, stderr: "" }
				: { code: 1, stdout: "", stderr: "" };
		}
		return { code: 0, stdout: "", stderr: "" };
	};
}

describe("buildNsis", () => {
	test("writes a script carrying every required directive without makensis", async () => {
		const root = await fixture();
		try {
			const result = await buildNsis({
				...OPTIONS,
				appPath: join(root, "dist", "app"),
				exec: fakeExec(false),
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected the tool to be missing");
			expect(result.reason).toBe("makensis is not on PATH");
			expect(result.requires).toBe("makensis");
			expect(describeNsis(result)).toContain("install makensis");

			// The script and the exe default beside the binary, inside `appPath`,
			// instead of one directory above it in the project root.
			const appPath = join(root, "dist", "app");
			const scriptPath = join(appPath, `${ID}.nsi`);
			expect(result.scriptPath).toBe(scriptPath);
			const script = await readFile(scriptPath, "utf8");
			for (const directive of REQUIRED) expect(script).toContain(directive);
			// Only the Windows binary is installed. `File /r` shipped the macOS
			// .app and every other format left in dist alongside it.
			expect(script).not.toContain("File /r");
			expect(script).not.toContain("\\\\*.*");
			expect(script).toContain(`File "${join(appPath, BINARY)}"`);
			expect(script.endsWith("SectionEnd\n")).toBe(true);

			expect(await stat(join(appPath, `${ID}-0.1.0-setup.exe`)).catch(() => undefined)).toBe(
				undefined,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("compiles the installer when makensis is present", async () => {
		const root = await fixture();
		try {
			const out = join(root, "out", "Example-setup.exe");
			const calls: string[][] = [];
			const exec: Exec = async (command) => {
				calls.push(command);
				if (command[0] === "which" || command[0] === "where") {
					return { code: 0, stdout: "/usr/bin/makensis\n", stderr: "" };
				}
				await writeFile(out, "MZ installer");
				return { code: 0, stdout: "", stderr: "" };
			};

			const result = await buildNsis({
				...OPTIONS,
				appPath: join(root, "dist", "app"),
				out,
				exec,
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.reason);
			expect(result.path).toBe(out);
			expect(result.bytes).toBe("MZ installer".length);
			expect(result.tool).toBe("makensis");
			expect(calls.some((command) => command.includes(result.scriptPath))).toBe(true);
			expect(describeNsis(result)).toContain(result.scriptPath);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
