#!/usr/bin/env bun
/**
 * Does a built crust app really reach the microphone? The machine-provable half is asserted here:
 * the bundle's Info.plist carries `NSMicrophoneUsageDescription`, a hardened-runtime signature
 * seals `com.apple.security.device.audio-input`, and the page reports `navigator.mediaDevices`.
 * The other half is a person: macOS asks for microphone access once per bundle identifier and only
 * a click answers it, so without one the run reports UNPROVEN instead of pretending to have tested
 * capture.
 *
 * A stable identifier means the prompt appears once ever; `--fresh-id` forces a new ask (and a new
 * prompt). `--wait-ms` bounds the wait for the person's answer. This is a diagnostic, not a gate:
 * like `e2e:notify` it opens a window and can need a human.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	clearSurvivors,
	guardFocus,
	restoreFocus,
	runCommand,
	survivorsOf,
	Verdict,
} from "./e2e-harness";
import { writeMediaProject } from "./media/project.ts";

const argv = Bun.argv.slice(2);
const crustIndex = argv.indexOf("--crust");
const crustArg = crustIndex >= 0 ? resolve(argv[crustIndex + 1] ?? "crust") : "crust";
// A checkout is run through Bun; an installed `crust` is already a command.
const crustCmd = crustArg.endsWith(".ts") ? ["bun", crustArg] : [crustArg];
const waitIndex = argv.indexOf("--wait-ms");
const waitMs = waitIndex >= 0 ? Number(argv[waitIndex + 1] ?? "120000") : 120_000;
const repo = resolve(import.meta.dir, "..");
const PURPOSE = "Media e2e records one audio track to prove the microphone reaches a crust app.";

/** `plutil` prints one value; a missing key is a non-zero exit, not an empty string. */
async function plistValue(appPath: string, key: string): Promise<string | undefined> {
	const result = await runCommand(
		["plutil", "-extract", key, "raw", "-o", "-", join(appPath, "Contents", "Info.plist")],
		appPath,
	);
	return result.code === 0 ? result.stdout.trim() : undefined;
}

async function entitlements(appPath: string): Promise<string> {
	const result = await runCommand(["codesign", "-d", "--entitlements", ":-", appPath], appPath);
	// codesign writes the dump to stderr on some versions and stdout on others.
	return `${result.stdout}\n${result.stderr}`;
}

async function main(): Promise<number> {
	const verdict = new Verdict();
	const id = argv.includes("--fresh-id")
		? `land.jyz.crust-media-e2e-${Math.random().toString(36).slice(2, 10)}`
		: "land.jyz.crust-media-e2e";
	// Outside the system temp directory, the same measured constraint the notify probe records.
	const cache = join(homedir(), ".cache");
	const name = "Media e2e";
	const frontmost = guardFocus();
	let root: string | undefined;
	let builtBinary: string | undefined;
	try {
		await mkdir(cache, { recursive: true });
		root = await mkdtemp(join(cache, "crust-e2e-media-"));
		const project = await writeMediaProject({
			root,
			repo,
			bundleId: id,
			name,
			purpose: PURPOSE,
		});
		const { appDir, appPath } = project;
		builtBinary = project.builtBinary;

		const install = await runCommand(["bun", "install"], appDir);
		verdict.check(
			"install",
			install.code === 0,
			install.code === 0 ? "bun install — exit 0" : `exit ${install.code}`,
		);

		const build = await runCommand([...crustCmd, "build"], appDir);
		verdict.check(
			"build",
			build.code === 0,
			build.code === 0
				? `${crustArg} build — exit 0`
				: `exit ${build.code}\n${build.stderr.slice(-600)}`,
		);
		if (build.code !== 0) return verdict.report("e2e-media");

		const purpose = await plistValue(appPath, "NSMicrophoneUsageDescription");
		verdict.check(
			"usage description",
			purpose === PURPOSE,
			purpose === undefined
				? "NSMicrophoneUsageDescription is absent from Info.plist"
				: `NSMicrophoneUsageDescription = ${purpose}`,
		);

		// The plain build signs ad-hoc without the hardened runtime, which needs no entitlement.
		// Sign again the way a Developer ID release does, so the entitlement half is really sealed.
		const { signApp } = await import("../src/packaging/sign.ts");
		await signApp({
			appPath,
			mode: "adhoc",
			hardenedRuntime: true,
			microphone: true,
		});
		const sealed = await entitlements(appPath);
		verdict.check(
			"audio-input entitlement",
			sealed.includes("com.apple.security.device.audio-input"),
			sealed.includes("com.apple.security.device.audio-input")
				? "com.apple.security.device.audio-input sealed"
				: `codesign -d --entitlements does not carry it: ${sealed.slice(-400)}`,
		);

		await clearSurvivors(builtBinary);
		const child = Bun.spawn([builtBinary], { stdout: "pipe", stderr: "pipe" });
		const stderr = new Response(child.stderr).text();
		let out = "";
		let sawDevices = false;
		let sawRequest = false;
		let answer: string | undefined;
		const deadline = setTimeout(() => child.kill("SIGKILL"), waitMs);
		// Lines are printed as they arrive, so the person can see the prompt instruction while the
		// run is still waiting instead of after it ends.
		for await (const chunk of child.stdout) {
			const text = new TextDecoder().decode(chunk);
			process.stdout.write(text);
			out += text;
			for (const line of text.split("\n")) {
				if (line.includes("mediaDevices present")) sawDevices = true;
				if (line.includes("request started")) {
					sawRequest = true;
					console.log(
						`  TCC       macOS is asking for microphone access — click Allow. Waiting ${Math.round(waitMs / 1000)} s.`,
					);
				}
				if (line.includes("getUserMedia granted")) answer = line.trim();
				if (line.includes("getUserMedia refused")) answer = line.trim();
			}
			if (answer !== undefined) break;
		}
		clearTimeout(deadline);
		const code = await child.exited;
		await stderr;
		if (answer === undefined) child.kill("SIGKILL");

		verdict.check(
			"mediaDevices",
			sawDevices,
			sawDevices
				? "navigator.mediaDevices and getUserMedia exist in the webview"
				: `the page never reported mediaDevices: ${out.slice(-400)}`,
		);
		const granted = answer?.includes("granted") === true;
		const refused = answer?.includes("refused") === true;
		verdict.check(
			"capture",
			granted,
			granted
				? `the stream carried audio: ${answer}`
				: refused
					? `${answer}\n          allow this app in System Settings > Privacy & Security > Microphone, or re-run with --fresh-id`
					: sawRequest
						? "UNPROVEN — the TCC prompt is unanswered; click Allow on the macOS dialog and run again"
						: "the page never started a getUserMedia request",
		);
		verdict.check("exit 0", granted && code === 0, `exited ${code}`);
		const survivors = await survivorsOf(builtBinary);
		verdict.check(
			"no survivors",
			survivors.length === 0,
			survivors.length === 0
				? "no process matches the binary path"
				: `pid ${survivors.join(", ")}`,
		);
		return verdict.report("e2e-media");
	} finally {
		if (builtBinary !== undefined) await clearSurvivors(builtBinary);
		if (root !== undefined) await rm(root, { recursive: true, force: true });
		await restoreFocus(frontmost);
	}
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-media: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
