/**
 * Phase 2-3: `crust package --format nsis` makes the installer, and the installer
 * makes an install — run with `/S` into a temp directory, then the tree it wrote is
 * read. A command that exited 0 is not an installer; the files are the proof.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBytes } from "../../../src/packaging/build.ts";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine } from "../../lib/text.ts";
import {
	BINARY_NAME,
	CLI,
	type Built,
	isPortableExecutable,
	MIN_BINARY_BYTES,
	MIN_INSTALLER_BYTES,
	REPO_ROOT,
} from "../nsis-fixture.ts";

/** The temp directory the silent install targets, removed by the caller. */
export function installTarget(): string {
	return join(process.env.RUNNER_TEMP ?? tmpdir(), `crust-nsis-install-${process.pid}`);
}

export async function installPhase(
	verdict: Verdict,
	scratch: string,
	built: Built,
): Promise<string> {
	const target = installTarget();
	await rm(target, { recursive: true, force: true });

	// ---- 2. the installer --------------------------------------------------
	const packed = await runCommand(
		[...CLI, "package", "--format", "nsis", "--dir", scratch],
		REPO_ROOT,
	);
	verdict.check(
		"package",
		packed.code === 0,
		packed.code === 0
			? "crust package --format nsis exited 0"
			: `crust package exited ${packed.code} — ${lastLine(packed.stderr) || lastLine(packed.stdout) || "no output"}`,
	);

	const installerStat = await stat(built.installer).catch(() => undefined);
	const exists = installerStat?.isFile() === true;
	verdict.check(
		"installer file",
		exists,
		exists
			? `${built.installer} is on disk`
			: `${built.installer} was never written — scratch holds ${(
					await readdir(scratch).catch(() => [] as string[])
				).join(", ")}`,
	);

	const pe = exists && (await isPortableExecutable(built.installer));
	verdict.check(
		"installer pe",
		pe,
		pe ? "the installer starts with MZ" : "no PE image at the installer path",
	);

	const bytes = installerStat?.size ?? 0;
	verdict.check(
		"installer size",
		exists && bytes > MIN_INSTALLER_BYTES,
		exists
			? `${formatBytes(bytes)} (${bytes} bytes), ${MIN_INSTALLER_BYTES / 1024 / 1024} MiB floor`
			: "no installer to measure",
	);

	// The line `crust package` printed is checked against the file rather than trusted.
	const printed = packed.stdout.match(/^nsis\s+(.+?)\s+(\d+) bytes\s+(.+?)\s+\(script (.+)\)$/m);
	const printedBytes = printed?.[2]?.trim() ?? "";
	const printedPath = printed?.[3]?.trim() ?? "";
	const printedScript = printed?.[4]?.trim() ?? "";
	verdict.check(
		"installer printed",
		printedBytes === String(bytes) &&
			printedPath === built.installer &&
			printedScript === built.script,
		printedBytes === String(bytes) &&
			printedPath === built.installer &&
			printedScript === built.script
			? `printed ${printedBytes} bytes, ${printedPath}, script ${printedScript}`
			: `printed ${printedBytes || "(none)"} bytes / ${printedPath || "(none)"} / script ${printedScript || "(none)"}, ` +
					`expected ${bytes} / ${built.installer} / ${built.script}`,
	);

	// ---- 3. the script, and where it installs ------------------------------
	const scriptText = await Bun.file(built.script)
		.text()
		.catch(() => "");
	const installDir = `InstallDir "$LOCALAPPDATA\\Programs\\${built.name}"`;
	// The payload is one named file, not the directory: copying `dist` would ship the
	// macOS `.app`, stray AppImages and earlier installers into a Windows install.
	verdict.check(
		"script",
		scriptText.includes(installDir) && scriptText.includes(`File "${built.binary}"`),
		scriptText.length === 0
			? `no script at ${built.script}`
			: scriptText.includes(installDir)
				? `the script installs under $LOCALAPPDATA and carries only the binary`
				: `the script has no ${installDir} line`,
	);
	// The installer must not embed itself: a script or setup `.exe` inside the payload
	// directory would ship itself inside the installer it defines.
	verdict.check(
		"script dir",
		!built.script.startsWith(`${built.dist}\\`) && !built.script.startsWith(`${built.dist}/`),
		built.script.startsWith(`${built.dist}\\`)
			? `${built.script} is inside ${built.dist}, so it would ship inside itself`
			: `${built.script} sits outside ${built.dist}`,
	);

	// ---- 4. install it -----------------------------------------------------
	const install = await runCommand([built.installer, "/S", `/D=${target}`], REPO_ROOT);
	verdict.check(
		"install",
		install.code === 0,
		install.code === 0
			? `the installer ran /S /D=${target} and exited 0`
			: `the installer exited ${install.code} — ${lastLine(install.stderr) || lastLine(install.stdout) || "no output"}`,
	);

	const installed = join(target, BINARY_NAME);
	const installedStat = await stat(installed).catch(() => undefined);
	const installedOk = installedStat?.isFile() === true && installedStat.size > MIN_BINARY_BYTES;
	const tree = (await readdir(target).catch(() => [] as string[])).sort();
	verdict.check(
		"install binary",
		installedOk,
		installedOk
			? `${installed} holds a ${installedStat?.size ?? 0} byte ${BINARY_NAME}`
			: `${installed} ${installedStat === undefined ? "is missing" : `is ${installedStat.size} bytes`} — ` +
					`the install holds ${tree.join(", ") || "nothing"}`,
	);

	const installedPe = installedOk && (await isPortableExecutable(installed));
	verdict.check(
		"install pe",
		installedPe,
		installedPe ? "the installed binary starts with MZ" : "no PE image at the installed path",
	);

	const uninstaller = join(target, "Uninstall.exe");
	const uninstallerStat = await stat(uninstaller).catch(() => undefined);
	verdict.check(
		"install uninstaller",
		uninstallerStat?.isFile() === true,
		uninstallerStat?.isFile() === true
			? `${uninstaller} is ${formatBytes(uninstallerStat.size)}`
			: `${uninstaller} was never written`,
	);

	// Created by the installer's own `SetOutPath`, never here.
	return target;
}
