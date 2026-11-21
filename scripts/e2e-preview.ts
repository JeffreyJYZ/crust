/**
 * E2E for `crust:preview`: a real `.docx` in the system QuickLook panel, `hide()` closing it, and a
 * path outside `fs.scope` refused by name.
 *
 * The fixture app mounts the plugin exactly as the runtime will — `createPreviewPlugin()` with no
 * arguments — so the `fs.scope` prefix in its config is what bounds the preview. That is the wiring
 * this proof covers, and why the plugin is constructed inside a running app rather than here: a panel
 * is a window of a running `NSApplication`, so a bare Bun process is not a real test of it.
 *
 * Linux and Windows are the named refusals, asserted here too, because "no panel on this platform" is
 * a contract of its own.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { clearSurvivors, guardFocus, restoreFocus, runCommand, Verdict } from "./e2e-harness.ts";
import { writeDocx } from "./preview/fixture.ts";
import { writePreviewProject } from "./preview/project.ts";

const REPO = resolve(import.meta.dir, "..");
const CLI = join(REPO, "src/cli/index.ts");

interface ShowLine {
	ok?: boolean;
	path?: string;
	visible?: boolean;
	window?: number;
	code?: string;
	message?: string;
	requires?: string;
}

/** The last `tag {...}` line on stdout, so the fixture's own log lines cannot answer first. */
function line(text: string, tag: string): ShowLine | undefined {
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index--) {
		const trimmed = lines[index]?.trim() ?? "";
		if (!trimmed.startsWith(`${tag} `)) continue;
		try {
			return JSON.parse(trimmed.slice(tag.length + 1)) as ShowLine;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

async function noPanel(verdict: Verdict, platform: string): Promise<number> {
	const { createPreviewPlugin } = await import("../src/plugins/preview.ts");
	const plugin = createPreviewPlugin({}, platform);
	const shown = await plugin.commands.show({ path: "/tmp/report.docx" });
	const hidden = await plugin.commands.hide();
	verdict.check(
		"show",
		shown.ok === false && "code" in shown && shown.code === "not-implemented",
		JSON.stringify(shown).slice(0, 200),
	);
	verdict.check(
		"hide",
		"code" in hidden && hidden.code === "not-implemented",
		JSON.stringify(hidden).slice(0, 200),
	);
	return verdict.report("e2e-preview");
}

async function main(): Promise<number> {
	const verdict = new Verdict();
	if (process.platform !== "darwin") return noPanel(verdict, process.platform);

	// Outside the system temp directory, the same measured constraint the media and notify probes carry.
	const cache = join(homedir(), ".cache");
	const name = "Preview e2e";
	const frontmost = guardFocus();
	let root: string | undefined;
	let builtBinary: string | undefined;
	try {
		await mkdir(cache, { recursive: true });
		root = await mkdtemp(join(cache, "crust-e2e-preview-"));
		const inside = join(root, "inside");
		const outside = join(root, "outside");
		const docx = await writeDocx(inside);
		await mkdir(outside, { recursive: true });
		const outsideFile = join(outside, "outside.txt");
		await writeFile(outsideFile, "outside the fs.scope prefix\n", "utf8");

		const project = await writePreviewProject({
			root,
			repo: REPO,
			bundleId: `land.jyz.crust-preview-e2e-${Math.random().toString(36).slice(2, 10)}`,
			name,
			file: docx,
			outsideFile,
		});
		builtBinary = project.builtBinary;

		const build = await runCommand(["bun", CLI, "build"], project.appDir, {
			timeoutMs: 180_000,
		});
		const built = build.code === 0;
		verdict.check(
			"build",
			built,
			built
				? `crust build wrote ${builtBinary}`
				: `exit ${build.code}: ${(build.stderr || build.stdout).slice(-400)}`,
		);
		if (!built) return verdict.report("e2e-preview");

		const run = await runCommand([builtBinary], project.appDir, {
			timeoutMs: 60_000,
		});
		const shown = line(run.stdout, "preview.show");
		const hidden = line(run.stdout, "preview.hide");
		const refused = line(run.stdout, "preview.refused");
		const error = line(run.stdout, "preview.error");

		verdict.check(
			"show",
			shown?.ok === true && shown.visible === true,
			shown === undefined
				? `no preview.show line — ${(error && error.message) || run.stdout.slice(-300) || run.stderr.slice(-300)}`
				: `visible ${shown.visible} in window ${shown.window}`,
		);
		verdict.check(
			"docx",
			shown?.path === docx,
			shown?.path === docx ? docx : `the panel was offered ${shown?.path ?? "nothing"}`,
		);
		verdict.check(
			"hide",
			hidden?.ok === true && hidden.visible === false,
			hidden === undefined ? "preview.hide printed nothing" : `visible ${hidden.visible}`,
		);
		verdict.check(
			"outside-scope",
			refused?.code === "outside-scope" && (refused.message ?? "").includes(outsideFile),
			refused === undefined
				? "the outside path was not refused at all"
				: `${refused.code}: ${(refused.message ?? "").slice(0, 220)}`,
		);
		verdict.check("exit 0", run.code === 0, `exited ${run.code}`);
		await clearSurvivors(builtBinary);
		return verdict.report("e2e-preview");
	} finally {
		if (builtBinary !== undefined) await clearSurvivors(builtBinary);
		if (root !== undefined) await rm(root, { recursive: true, force: true });
		await restoreFocus(frontmost);
	}
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-preview: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
