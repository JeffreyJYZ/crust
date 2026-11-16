/**
 * The artefact itself, checked rather than trusted: an ELF carrying the AppImage type-2 magic, an
 * executable bit, a size floor, and the AppDir `--appimage-extract` gives back — `AppRun`, the
 * binary it names, the `.desktop` entry and the icon. Every string is compared with the function
 * that writes it (`appRun`, `desktopEntry`), so the image cannot drift from the code that made it.
 */
import { mkdir, readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { BINARY_NAME } from "../../../src/cli/package/options.ts";
import { appRun, desktopEntry } from "../../../src/packaging/appimage.ts";
import { formatBytes } from "../../../src/packaging/build.ts";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine } from "../../lib/text.ts";
import { MIN_APPIMAGE_BYTES, type Staged } from "./fixture.ts";

const ELF = [0x7f, 0x45, 0x4c, 0x46];
/** `AI\x02` at offset 8: what makes the ELF a type-2 AppImage rather than any other executable. */
const APPIMAGE_TYPE_2 = [0x41, 0x49, 0x02];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The one line `describeAppImage` prints, split so each part is compared with the file. */
export interface Printed {
	size: string;
	bytes: number;
	path: string;
	tool: string;
}

export function parsePrinted(stdout: string): Printed | undefined {
	const found = stdout.match(/^appimage\s+(\S+ \S+)\s+(\d+) bytes\s+(.+?)\s+\(([^()]+)\)$/m);
	if (!found) return undefined;
	return {
		size: found[1] ?? "",
		bytes: Number(found[2]),
		path: found[3]?.trim() ?? "",
		tool: found[4] ?? "",
	};
}

function startsWith(bytes: Uint8Array, magic: number[], at = 0): boolean {
	return magic.every((byte, index) => bytes[at + index] === byte);
}

/** An executable ELF at `path`, as one line of evidence. */
async function elfAt(path: string): Promise<{ ok: boolean; detail: string }> {
	const info = await stat(path).catch(() => undefined);
	if (info?.isFile() !== true) return { ok: false, detail: `${path} is not a file` };
	const head = new Uint8Array(await readFile(path)).subarray(0, 16);
	const executable = (info.mode & 0o111) !== 0;
	return {
		ok: startsWith(head, ELF) && executable,
		detail: `${path} is ${info.size} bytes, mode ${(info.mode & 0o777).toString(8)}, ELF=${startsWith(head, ELF)}`,
	};
}

export async function artifactPhase(
	verdict: Verdict,
	staged: Staged,
	printed: Printed | undefined,
	extractDir: string,
): Promise<void> {
	const info = await stat(staged.image).catch(() => undefined);
	const exists = info?.isFile() === true;
	const bytes = info?.size ?? 0;

	const head = exists
		? new Uint8Array(await readFile(staged.image)).subarray(0, 12)
		: new Uint8Array();
	verdict.check(
		"appimage elf",
		exists && startsWith(head, ELF) && startsWith(head, APPIMAGE_TYPE_2, 8),
		exists
			? `first bytes ${[...head].map((b) => b.toString(16).padStart(2, "0")).join(" ")} — ELF with the AI\\x02 type-2 magic`
			: "no image to read",
	);

	verdict.check(
		"appimage size",
		bytes > MIN_APPIMAGE_BYTES,
		exists
			? `${formatBytes(bytes)} (${bytes} bytes), ${MIN_APPIMAGE_BYTES / 1024 / 1024} MiB floor`
			: "no image to measure",
	);

	verdict.check(
		"appimage mode",
		exists && (info.mode & 0o111) !== 0,
		exists ? `mode ${(info.mode & 0o777).toString(8)} — the image is executable` : "no image",
	);

	// The printed line is a claim about a file, so its size and path are compared with the file.
	const printedOk =
		printed !== undefined &&
		printed.bytes === bytes &&
		printed.path === staged.image &&
		printed.size === formatBytes(bytes);
	verdict.check(
		"printed bytes",
		printedOk,
		printedOk
			? `printed ${printed?.size} (${printed?.bytes} bytes) ${printed?.path} (${printed?.tool})`
			: `printed ${printed ? `${printed.size} / ${printed.bytes} bytes / ${printed.path}` : "(no appimage line)"}` +
					` — the file is ${formatBytes(bytes)} (${bytes} bytes) at ${staged.image}`,
	);

	await mkdir(extractDir, { recursive: true });
	const extract = await runCommand([staged.image, "--appimage-extract"], extractDir);
	const root = join(extractDir, "squashfs-root");
	const extracted = await stat(root).catch(() => undefined);
	verdict.check(
		"extract",
		extract.code === 0 && extracted?.isDirectory() === true,
		extract.code === 0
			? `${staged.image} --appimage-extract gave back ${root}`
			: `--appimage-extract exited ${extract.code} — ${lastLine(extract.stderr) || lastLine(extract.stdout)}`,
	);
	if (extracted?.isDirectory() !== true) return;

	const appRunPath = join(root, "AppRun");
	const appRunStat = await stat(appRunPath).catch(() => undefined);
	const appRunBody = appRunStat ? await readFile(appRunPath, "utf8") : "";
	const pointsAt = join(root, "usr", "bin", BINARY_NAME);
	const targetStat = await stat(pointsAt).catch(() => undefined);
	verdict.check(
		"apprun",
		appRunBody === appRun(BINARY_NAME) &&
			((appRunStat?.mode ?? 0) & 0o111) !== 0 &&
			targetStat?.isFile() === true,
		appRunBody === appRun(BINARY_NAME)
			? `AppRun is executable and execs usr/bin/${BINARY_NAME}, which exists`
			: `AppRun holds ${JSON.stringify(appRunBody)} — expected ${JSON.stringify(appRun(BINARY_NAME))}`,
	);

	const desktopPath = join(root, "usr", "share", "applications", `${staged.id}.desktop`);
	const desktop = await readFile(desktopPath, "utf8").catch(() => "");
	const expected = desktopEntry({ id: staged.id, name: staged.name, binaryName: BINARY_NAME });
	verdict.check(
		"desktop entry",
		desktop === expected,
		desktop === expected
			? `${staged.id}.desktop carries Name=${staged.name}, Exec=${BINARY_NAME}, Icon=${staged.id}`
			: `desktop entry is ${JSON.stringify(desktop)} — expected ${JSON.stringify(expected)}`,
	);

	const link = await readlink(join(root, `${staged.id}.desktop`)).catch(() => "");
	verdict.check(
		"desktop link",
		link === join("usr", "share", "applications", `${staged.id}.desktop`),
		link.length > 0
			? `the root ${staged.id}.desktop appimagetool reads is a symlink to ${link}`
			: "the root .desktop is missing, so appimagetool had no entry to read",
	);

	const iconPath = join(
		root,
		"usr",
		"share",
		"icons",
		"hicolor",
		"512x512",
		"apps",
		`${staged.id}.png`,
	);
	const iconBytes = new Uint8Array(await readFile(iconPath).catch(() => new Uint8Array()));
	verdict.check(
		"icon",
		iconBytes.byteLength > 0 && startsWith(iconBytes, PNG_SIGNATURE),
		iconBytes.byteLength > 0
			? `${staged.id}.png is ${iconBytes.byteLength} bytes and starts with the PNG signature`
			: `${iconPath} is missing`,
	);

	const binary = await elfAt(pointsAt);
	verdict.check("binary", binary.ok, binary.detail);
}
