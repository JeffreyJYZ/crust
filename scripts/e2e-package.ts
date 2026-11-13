/**
 * The end-to-end proof for packaging: `crust dmg` makes a disk image, and
 * `crust sign` refuses honestly when there is no certificate.
 *
 * `e2e.ts` stops once the app answers from inside its bundle. The two commands a
 * user reaches for *after* that had no proof at all: `dmg` had produced one
 * 38.70 MiB image by hand, and `sign` had never been exercised — yet its refusal
 * is the path every user without a Developer ID takes, so the wording of that
 * refusal is the feature, not an error path to skip.
 *
 * Everything goes through the real CLI, in a scratch copy of `examples/hello`,
 * so the checkout's own `dist/` is never touched and the whole temp directory can
 * be deleted at the end. The bundle is never launched: an ad-hoc bundle runs on
 * this machine and is refused by Gatekeeper elsewhere, so `open` would prove
 * nothing and raise a dialog.
 *
 * Three facts this proof is built around:
 *
 *   - `diskutil image create from` writes an APFS container, so `hdiutil attach`
 *     prints several `/dev/disk*` lines and only one carries the mount point. The
 *     device to detach is parsed from that table, never guessed from
 *     `/Volumes/<name>`;
 *   - a failed assertion must not leave a volume mounted, because the user sees it
 *     on their desktop. Detach lives in a `finally`, and the run ends by proving
 *     nothing from the image is still attached;
 *   - `crust sign` fails before it reads the bundle, so the assertion that matters
 *     is that the refusal changed nothing: the binary's hash and the bundle's seal
 *     are identical afterwards.
 *
 * Usage:
 *   bun run scripts/e2e-package.ts    # or `bun run e2e:package` once package.json defines it
 */

import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readlink, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { formatBytes } from "../src/packaging/build.ts";
import { runCommand, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
// CRUST_BIN lets the same suite judge a *shipped* crust — an installed tarball or a
// compiled binary — rather than this checkout. Default is the checkout.
const CLI = process.env.CRUST_BIN ?? join(REPO_ROOT, "src/cli/index.ts");
const EXAMPLE_DIR = join(REPO_ROOT, "examples/hello");

/** `CFBundleExecutable` that `crust build` pins. Same constant as `e2e.ts`. */
const BINARY_NAME = "crust-app";

/**
 * The example imports `crust`, which resolves through this package's own exports
 * map inside the checkout. A scratch copy has no install, so one symlink to the
 * checkout stands in for it — and it is also what `projectCrustRoot` realpaths, so
 * the compiled binary carries exactly one copy of the framework.
 */
const FALLBACK_DEPENDENCY = REPO_ROOT;

/** A stub image is the failure this refuses: the app alone is ~85 MiB. */
const MIN_DMG_BYTES = 10 * 1024 * 1024;

/** The volume currently attached, so a throw can still detach it. */
let attachment: Attachment | undefined;
/** Where it was mounted, kept after detach so the run can assert it is gone. */
let mountedAt: string | null = null;

interface Attachment {
	/** Every device line `hdiutil attach` printed, in order. */
	devices: string[];
	/** The device whose line carried the mount point. */
	mountedDevice: string;
	mountPoint: string;
	dmgPath: string;
}

/** The example's own manifest: the bundle and image names come from here. */
interface ExampleConfig {
	app: { name: string; version: string };
}

function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/** Mark every listed assertion failed when an earlier step made them unknowable. */
function skip(verdict: Verdict, names: string[], why: string): void {
	for (const name of names) verdict.check(name, false, why);
}

/** One detail line, so the captured refusal is visible verbatim in the log. */
function note(text: string): void {
	console.log(`  note  ${text}`);
}

/** The bundle's binary, as a digest — the cheapest "did this change" proof. */
async function sha256(path: string): Promise<string> {
	const bytes = await Bun.file(path)
		.arrayBuffer()
		.catch(() => undefined);
	if (bytes === undefined) return "missing";
	return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

/** Every `.dmg` in `dir`, sorted — the set a second run must not grow. */
async function listDmgs(dir: string): Promise<string[]> {
	const entries = await readdir(dir).catch(() => [] as string[]);
	return entries.filter((name) => name.endsWith(".dmg")).sort();
}

/** Top-level names in `dist`, for "did the command touch anything" checks. */
async function listDist(dir: string): Promise<string[] | undefined> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return undefined;
	}
}

/**
 * Parse `hdiutil attach`'s table into the device to detach.
 *
 * The table is tab-separated, `/dev/disk*` first and the mount point last, and an
 * image made by `diskutil image create from` prints four lines for one mount
 * (partition scheme, APFS container, its slice). Only one line names a mount
 * point, so that line — never a guess at `/Volumes/<name>` — is what is detached.
 */
export function parseAttachment(stdout: string, dmgPath: string): Attachment | undefined {
	const devices: string[] = [];
	let mountedDevice = "";
	let mountPoint = "";
	for (const raw of stdout.split("\n")) {
		const cells = raw
			.split(/\t+|\s{2,}/)
			.map((cell) => cell.trim())
			.filter((cell) => cell.length > 0);
		const device = cells[0];
		if (device === undefined || !device.startsWith("/dev/disk")) continue;
		devices.push(device);
		const mounted = cells.find((cell) => cell.startsWith("/") && !cell.startsWith("/dev/"));
		if (mounted !== undefined && mountPoint.length === 0) {
			mountPoint = mounted;
			mountedDevice = device;
		}
	}
	if (mountPoint.length === 0 || mountedDevice.length === 0) return undefined;
	return { devices, mountedDevice, mountPoint, dmgPath };
}

/** Whether `mountPoint` is still in the mount table, matched as a whole field. */
async function isMounted(mountPoint: string): Promise<boolean> {
	const { stdout } = await runCommand(["mount"], REPO_ROOT);
	return stdout.split("\n").some((line) => line.includes(` on ${mountPoint} (`));
}

/** Whether `hdiutil` still holds `dmgPath`; the image path is unique per run. */
async function imageAttached(dmgPath: string): Promise<boolean> {
	const { stdout } = await runCommand(["hdiutil", "info"], REPO_ROOT);
	return stdout.includes(dmgPath);
}

/**
 * Eject the image, escalating from the container device to `-force`.
 *
 * Detaching the whole disk (`/dev/disk15` for `/dev/disk15s1`) is what releases an
 * APFS container; detaching the slice alone can leave the container behind. The
 * result is verified against the mount table and `hdiutil info`, because an exit 0
 * from a deprecated command is not the same fact as an unmounted volume.
 */
async function detachImage(target: Attachment): Promise<{ ok: boolean; detail: string }> {
	const candidates = [
		target.mountedDevice.replace(/s\d+$/, ""),
		target.mountedDevice,
		...[...target.devices].reverse(),
	];
	const tried = new Set<string>();
	let last = "no device line to detach";
	for (const device of candidates) {
		if (device.length === 0 || tried.has(device)) continue;
		tried.add(device);
		for (const force of [false, true]) {
			const args = ["hdiutil", "detach", ...(force ? ["-force"] : []), device];
			const result = await runCommand(args, REPO_ROOT);
			last = `${args.join(" ")} exited ${result.code}`;
			if (result.code !== 0) continue;
			const stillMounted = await isMounted(target.mountPoint);
			const stillAttached = await imageAttached(target.dmgPath);
			if (!stillMounted && !stillAttached) {
				return { ok: true, detail: `${device} ejected ${target.mountPoint}` };
			}
			last += stillMounted
				? ` but ${target.mountPoint} is still mounted`
				: " but the image is still attached";
		}
	}
	return { ok: false, detail: `${last} — ${target.mountPoint} may still be on the desktop` };
}

/** Detach whatever this run left behind. Idempotent, never throws. */
async function detachLeftover(): Promise<void> {
	if (attachment === undefined) return;
	const mounted = await isMounted(attachment.mountPoint);
	const attached = await imageAttached(attachment.dmgPath);
	if (!mounted && !attached) return;
	await detachImage(attachment).catch(() => undefined);
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-package: SKIP  this proof builds a macOS .dmg and needs hdiutil; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-package-"));
	try {
		await proof(verdict, scratch);
	} finally {
		// A throw must leave neither a volume on the user's desktop nor a temp tree.
		await detachLeftover().catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const leftMounted = mountedAt !== null && (await isMounted(mountedAt));
	verdict.check(
		"mount clear",
		!leftMounted,
		leftMounted
			? `${mountedAt} is still mounted — detach it before this run is trusted`
			: `nothing from the image remains mounted${mountedAt ? ` (${mountedAt} was ejected)` : ""}`,
	);

	const scratchLeft = await stat(scratch)
		.then(() => true)
		.catch(() => false);
	verdict.check(
		"scratch gone",
		!scratchLeft,
		scratchLeft ? `${scratch} still exists` : `removed ${scratch}`,
	);

	return verdict.report("e2e-package");
}

async function proof(verdict: Verdict, scratch: string): Promise<void> {
	const configured = (await import(join(EXAMPLE_DIR, "crust.config.ts")))
		.default as ExampleConfig;
	const dist = join(scratch, "dist");
	const bundle = join(dist, `${configured.app.name}.app`);
	const binary = join(bundle, "Contents", "MacOS", BINARY_NAME);
	const image = join(dist, `${configured.app.name}-${configured.app.version}.dmg`);

	// ---- 0. the scratch project this proof packages ------------------------
	await mkdir(join(scratch, "node_modules"), { recursive: true });
	await symlink(FALLBACK_DEPENDENCY, join(scratch, "node_modules", "crust"), "dir");
	for (const name of ["crust.config.ts", "main.ts", "public"]) {
		await cp(join(EXAMPLE_DIR, name), join(scratch, name), { recursive: true });
	}
	const inputs = await Promise.all(
		["crust.config.ts", "main.ts", "public/index.html"].map((name) =>
			stat(join(scratch, name))
				.then((entry) => entry.isFile())
				.catch(() => false),
		),
	);
	verdict.check(
		"sandbox",
		inputs.every(Boolean),
		inputs.every(Boolean)
			? `copied examples/hello into ${scratch}`
			: `incomplete copy in ${scratch}: ${inputs.map((ok, i) => `${["config", "main", "page"][i]} ${ok ? "ok" : "missing"}`).join(", ")}`,
	);

	// ---- 1. `crust build`, the command `dmg` and `sign` both require -------
	const build = await runCommand(["bun", "run", CLI, "build", "--dir", scratch], REPO_ROOT);
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0 && namedBundle;
	verdict.check(
		"build",
		built,
		build.code !== 0
			? `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`
			: namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`,
	);

	if (!built) {
		skip(
			verdict,
			[
				"done claim",
				"bundle",
				"dmg",
				"dmg file",
				"dmg size",
				"dmg path",
				"dmg bytes",
				"hdiutil verify",
				"attach",
				"image app",
				"image link",
				"volume",
				"detach",
				"sign",
				"sign message",
				"sign honest",
				"sign keeps",
				"sign seal",
			],
			"not checked — crust build failed",
		);
		if (build.code !== 0) console.log(build.stdout + build.stderr);
		return;
	}

	// `done — open it locally with: open X` is a claim about a file, so the file
	// it names is what is checked: a "done" line pointing at nothing is the exact
	// failure this catches.
	const done = build.stdout.match(/^done — open it locally with: open (.+)$/m);
	const donePath = done?.[1]?.trim() ?? "";
	const doneStat = donePath.length > 0 ? await stat(donePath).catch(() => undefined) : undefined;
	verdict.check(
		"done claim",
		doneStat?.isDirectory() === true,
		doneStat?.isDirectory() === true
			? `the done line names an existing bundle: ${donePath}`
			: done === null
				? "crust build printed no done line naming a bundle"
				: `the done line names ${donePath}, which is not a directory`,
	);

	const bundleStat = await stat(bundle).catch(() => undefined);
	const binaryStat = await stat(binary).catch(() => undefined);
	const packaged =
		bundleStat?.isDirectory() === true &&
		binaryStat?.isFile() === true &&
		(binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"bundle",
		packaged,
		packaged
			? `${bundle} holds a ${binaryStat?.size ?? 0} byte executable ${BINARY_NAME}`
			: `${bundle} ${bundleStat?.isDirectory() === true ? `has no executable ${binary}` : "is missing"}`,
	);

	// ---- 2. `crust dmg` makes a real image ---------------------------------
	const dmgsBefore = await listDmgs(dist);
	const dmgRun = await runCommand(["bun", "run", CLI, "dmg", "--dir", scratch], REPO_ROOT);
	const dmgOk = dmgRun.code === 0;
	verdict.check(
		"dmg",
		dmgOk,
		dmgOk
			? "crust dmg exited 0"
			: `crust dmg exited ${dmgRun.code} — ${lastLine(dmgRun.stderr) || lastLine(dmgRun.stdout) || "no output"}`,
	);

	const dmgsAfter = await listDmgs(dist);
	const created = dmgsAfter.filter((name) => !dmgsBefore.includes(name));
	const dmgStat = await stat(image).catch(() => undefined);
	const imageExists = dmgStat?.isFile() === true;
	const imageBytes = dmgStat?.size ?? 0;

	verdict.check(
		"dmg file",
		dmgOk && created.length === 1 && created[0] === basename(image) && imageExists,
		dmgOk
			? !imageExists
				? `${image} was never written (dist holds ${dmgsAfter.join(", ") || "no .dmg"})`
				: created.length !== 1
					? `${created.length} new .dmg file(s) in dist: ${created.join(", ") || "none"}`
					: `${created[0]} is the one new image`
			: "not checked — crust dmg failed",
	);

	verdict.check(
		"dmg size",
		imageExists && imageBytes > MIN_DMG_BYTES,
		imageExists
			? `${formatBytes(imageBytes)} (${imageBytes} bytes), ${MIN_DMG_BYTES / 1024 / 1024} MiB floor`
			: "no image to measure",
	);

	// The commands print paths, a size and a volume name; each is checked against
	// the artefact rather than trusted as text.
	const imageLine = dmgRun.stdout.match(/^\s{2}image\s+(.+?) \(([^()]+)\)$/m);
	const bundleLine = dmgRun.stdout.match(/^\s{2}bundle\s+(.+)$/m);
	const volumeLine = dmgRun.stdout.match(/^\s{2}volume\s+(.+)$/m);
	const printedImage = imageLine?.[1]?.trim() ?? "";
	const printedBundle = bundleLine?.[1]?.trim() ?? "";
	const printedVolume = volumeLine?.[1]?.trim() ?? "";

	verdict.check(
		"dmg path",
		printedImage === image && printedBundle === bundle,
		printedImage === image && printedBundle === bundle
			? `printed image and bundle paths are the files on disk`
			: `printed image ${printedImage || "(none)"} / bundle ${printedBundle || "(none)"} — ` +
					`expected ${image} / ${bundle}`,
	);

	const printedBytes = imageLine?.[2]?.trim() ?? "";
	const actualBytes = imageExists ? formatBytes(imageBytes) : "no image";
	verdict.check(
		"dmg bytes",
		printedBytes === actualBytes,
		printedBytes === actualBytes
			? `printed size matches the file: ${printedBytes}`
			: `printed ${printedBytes || "(none)"} but the file is ${actualBytes}`,
	);

	const verify = await runCommand(["hdiutil", "verify", image], REPO_ROOT);
	verdict.check(
		"hdiutil verify",
		verify.code === 0,
		verify.code === 0
			? "hdiutil verify reports a valid checksum"
			: `hdiutil verify exited ${verify.code} — ${lastLine(verify.stderr) || lastLine(verify.stdout)}`,
	);

	// ---- 3. the image holds the app, and comes off again -------------------
	const attach = await runCommand(
		["hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", image],
		REPO_ROOT,
	);
	attachment = attach.code === 0 ? parseAttachment(attach.stdout, image) : undefined;
	mountedAt = attachment?.mountPoint ?? null;
	verdict.check(
		"attach",
		attachment !== undefined,
		attachment
			? `${attachment.mountPoint} on ${attachment.mountedDevice} (${attachment.devices.length} device lines parsed)`
			: attach.code !== 0
				? `hdiutil attach exited ${attach.code} — ${lastLine(attach.stderr) || lastLine(attach.stdout)}`
				: `hdiutil attach exited 0 but printed no mount point — ${lastLine(attach.stdout)}`,
	);

	let detached = { ok: false, detail: "nothing was attached, so nothing needed detaching" };
	try {
		if (attachment === undefined) {
			skip(
				verdict,
				["image app", "image link", "volume"],
				"not checked — the image never mounted",
			);
		} else {
			const inside = join(attachment.mountPoint, `${configured.app.name}.app`);
			const insideStat = await stat(inside).catch(() => undefined);
			const insideBinary = await stat(join(inside, "Contents", "MacOS", BINARY_NAME)).catch(
				() => undefined,
			);
			verdict.check(
				"image app",
				insideStat?.isDirectory() === true && insideBinary?.isFile() === true,
				insideStat?.isDirectory() === true && insideBinary?.isFile() === true
					? `${inside} holds an executable ${BINARY_NAME}`
					: `${inside} ${insideStat?.isDirectory() === true ? "has no executable" : "is missing"}`,
			);

			// The drag-to-Applications convention is the point of the image: without
			// this symlink the mounted folder is a copy of the app and nothing more.
			const link = join(attachment.mountPoint, "Applications");
			const linkStat = await lstat(link).catch(() => undefined);
			const linkTarget = linkStat?.isSymbolicLink() === true ? await readlink(link) : "";
			verdict.check(
				"image link",
				linkTarget === "/Applications",
				linkTarget === "/Applications"
					? "Applications points at /Applications, so one drag installs"
					: `Applications ${linkStat ? `points at ${linkTarget || "?"}` : "is missing"} — the image is a copy of the app, not an installer`,
			);

			const mountedName = basename(attachment.mountPoint);
			verdict.check(
				"volume",
				printedVolume === mountedName,
				printedVolume === mountedName
					? `printed volume "${printedVolume}" is the mounted volume`
					: `printed volume "${printedVolume || "(none)"}" but the image mounted as "${mountedName}"`,
			);
		}
	} finally {
		// Not an assertion's job: a failed check above must not leave the volume on
		// the desktop, so the detach runs whatever happened inside the `try`.
		if (attachment !== undefined) detached = await detachImage(attachment);
	}

	verdict.check("detach", detached.ok, detached.detail);

	// ---- 4. `crust sign` refuses without a certificate ---------------------
	// The refusal path is only reachable with the variable unset, so the run sets
	// that up itself. It is restored afterwards and never printed: it can name a
	// real certificate.
	const inherited = process.env.CRUST_SIGNING_IDENTITY;
	delete process.env.CRUST_SIGNING_IDENTITY;
	const binaryBefore = await sha256(binary);
	const distBefore = await listDist(dist);
	const signatureBefore = await runCommand(["codesign", "-dv", "--verbose=4", bundle], REPO_ROOT);
	const signRun = await runCommand(["bun", "run", CLI, "sign", "--dir", scratch], REPO_ROOT);
	if (inherited !== undefined) process.env.CRUST_SIGNING_IDENTITY = inherited;
	if (inherited !== undefined) {
		note("CRUST_SIGNING_IDENTITY was set in this shell; unset here so the refusal path runs");
	}

	verdict.check(
		"sign",
		signRun.code !== 0,
		signRun.code !== 0
			? `crust sign exited ${signRun.code} instead of signing something it cannot verify`
			: "crust sign exited 0 with no certificate — a signature nobody can notarize was claimed as success",
	);

	// The message is the feature: a user without a certificate needs to be told
	// what is missing and what to get. The exact text is printed, so a regression
	// in wording is visible in the log rather than only in a boolean.
	const refusal = (signRun.stderr || signRun.stdout).trim();
	const refusalLine = refusal.split("\n")[0]?.trim() ?? "";
	if (refusalLine.length > 0) note(`crust sign said: ${refusalLine}`);
	const namesVariable = refusal.includes("CRUST_SIGNING_IDENTITY");
	const namesWhatsMissing = /Developer ID/.test(refusal) && /certificate|identity/i.test(refusal);
	const namesConsequence = /Gatekeeper|ad-hoc|another machine/i.test(refusal);
	const singleLine = refusal.split("\n").length === 1 && refusal.length > 0;
	verdict.check(
		"sign message",
		singleLine && namesVariable && namesWhatsMissing && namesConsequence,
		singleLine && namesVariable && namesWhatsMissing && namesConsequence
			? "one line naming the variable, the Developer ID certificate and the Gatekeeper consequence"
			: !singleLine
				? `stderr is ${refusal.split("\n").length} lines, not one actionable line: ${refusalLine || "(empty)"}`
				: `the refusal never names ${[
						namesVariable ? "" : "CRUST_SIGNING_IDENTITY",
						namesWhatsMissing ? "" : "the missing certificate",
						namesConsequence ? "" : "what Gatekeeper does about it",
					]
						.filter((part) => part.length > 0)
						.join(", ")} — a user cannot act on it`,
	);

	// A command that fails must not also claim it signed. Only `signed` is the
	// claim; the header line naming the config is not.
	verdict.check(
		"sign honest",
		!/^\s{2}signed\s/m.test(signRun.stdout),
		/^\s{2}signed\s/m.test(signRun.stdout)
			? `crust sign printed a signed line while exiting ${signRun.code}`
			: "stdout claims nothing about signing",
	);

	// The failure must be a refusal, not damage: same binary bytes, same files in
	// `dist`, so a user can go on building and signing elsewhere.
	const binaryAfter = await sha256(binary);
	const distAfter = await listDist(dist);
	const before = distBefore ?? [];
	const after = distAfter ?? [];
	const unchanged = binaryBefore !== "missing" && binaryAfter === binaryBefore;
	const filesSame =
		distBefore !== undefined &&
		distAfter !== undefined &&
		before.join("\n") === after.join("\n");
	verdict.check(
		"sign keeps",
		unchanged && filesSame,
		unchanged && filesSame
			? `binary ${binaryBefore.slice(0, 12)} and ${before.length} dist entries unchanged`
			: !unchanged
				? `the refused command changed the binary: ${binaryBefore.slice(0, 12)} -> ${binaryAfter.slice(0, 12)}`
				: `the refused command changed dist: ${before.join(", ")} -> ${after.join(", ")}`,
	);

	// The ad-hoc seal `crust build` made must still verify: a half-applied
	// signature would leave a bundle that no longer runs.
	const seal = await runCommand(["codesign", "--verify", "--strict", bundle], REPO_ROOT);
	const sealText = `${signatureBefore.stderr}${signatureBefore.stdout}`;
	const stillAdhoc = /^Signature=adhoc$/m.test(sealText);
	verdict.check(
		"sign seal",
		seal.code === 0 && stillAdhoc,
		seal.code === 0 && stillAdhoc
			? "codesign --verify --strict still passes and the signature is still adhoc"
			: seal.code !== 0
				? `codesign --verify --strict exited ${seal.code} — ${lastLine(seal.stderr) || lastLine(seal.stdout)}`
				: `the signature is no longer adhoc — ${lastLine(sealText)}`,
	);
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the volume and the scratch tree are cleaned in
	// `main`'s finally before this line is reached.
	console.log(`e2e-package: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
