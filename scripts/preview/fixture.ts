/**
 * The file the panel is asked to render: a real `.docx`, written by macOS's own `textutil` so it is a
 * genuine Office document rather than a zip the QuickLook generator may refuse. `qlmanage` could
 * produce a thumbnail, but a document is what an app previews, so the fixture is a document.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand } from "../e2e-harness.ts";

/** Write `report.docx` into `dir` and answer its absolute path. */
export async function writeDocx(dir: string): Promise<string> {
	await mkdir(dir, { recursive: true });
	const source = join(dir, "source.txt");
	const file = join(dir, "report.docx");
	await writeFile(source, "crust preview e2e\nthe panel rendered this document\n", "utf8");
	const converted = await runCommand(
		["textutil", "-convert", "docx", "-output", file, source],
		dir,
	);
	if (converted.code !== 0) {
		throw new Error(`textutil could not write a .docx: ${converted.stderr.trim()}`);
	}
	return file;
}
