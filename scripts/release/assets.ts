/**
 * The asset half of release verification: what a release says it attached, the download,
 * and the checks on one file. `verify-assets.ts` owns argument parsing and the verdict, so
 * neither module outgrows one screen — and the split is by responsibility, not by length.
 */
import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { artifactName, TARGETS, type Target, VERSION } from "./targets.ts";

/**
 * A compile is ~90–120 MB, so anything under a megabyte is a truncated upload or an error
 * page `gh` saved under the right name. The floor is a tripwire, not a size test.
 */
const MIN_BYTES = 1_000_000;

export interface Gap {
	what: string;
	detail: string;
}

export function gh(args: string[]): { code: number; stdout: string; stderr: string } {
	const run = Bun.spawnSync(["gh", ...args], {
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		code: run.exitCode ?? 1,
		stdout: run.stdout.toString().trim(),
		stderr: run.stderr.toString().trim(),
	};
}

/** `GITHUB_REPOSITORY` in CI; a checkout elsewhere asks `gh` which repo it is in. */
export function repo(): string {
	const fromEnv = process.env.GITHUB_REPOSITORY;
	if (fromEnv) return fromEnv;
	return gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).stdout;
}

/** The asset names the release claims to have, plus the gap when the query itself failed. */
export function attached(tag: string, where: string): { names: string[]; gap?: Gap } {
	const listed = gh([
		"release",
		"view",
		tag,
		"--repo",
		where,
		"--json",
		"assets",
		"-q",
		".assets[].name",
	]);
	if (listed.code !== 0) {
		return {
			names: [],
			gap: {
				what: "release",
				detail: `gh release view ${tag} failed: ${listed.stderr || listed.code}`,
			},
		};
	}
	return { names: listed.stdout.split("\n").filter((row) => row !== "") };
}

export function download(tag: string, where: string, dir: string): Gap | undefined {
	const run = gh(["release", "download", tag, "--repo", where, "--dir", dir, "--clobber"]);
	if (run.code === 0) return undefined;
	return {
		what: "download",
		detail: `gh release download ${tag} failed: ${run.stderr || run.code}`,
	};
}

/** The container's first bytes, as hex: proves the OS even for a binary that cannot run here. */
async function magic(path: string): Promise<string> {
	const head = new Uint8Array(await Bun.file(path).slice(0, 4).arrayBuffer());
	return [...head].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AssetResult {
	lines: string[];
	gaps: Gap[];
	bytes: number;
}

/** Present, non-trivial, the right container, and — only on its own platform — executes. */
export async function checkAsset(
	key: Target,
	dir: string,
	host: Target | undefined,
): Promise<AssetResult> {
	const name = artifactName(key);
	const result: AssetResult = { lines: [], gaps: [], bytes: 0 };
	const info = await stat(join(dir, name)).catch(() => undefined);
	if (!info?.isFile()) {
		result.gaps.push({ what: "absent", detail: `${name} is not in ${dir} after download` });
		return result;
	}
	result.bytes = info.size;
	if (info.size < MIN_BYTES) {
		result.gaps.push({
			what: "size",
			detail: `${name} is ${info.size} bytes, under the ${MIN_BYTES} floor`,
		});
		return result;
	}

	const found = await magic(join(dir, name));
	// Prefix, not equality: a PE header is `MZ` plus a DOS stub whose next bytes vary,
	// while ELF and Mach-O are four. Comparing the full read against `4d5a` rejects a
	// perfectly good Windows binary (measured on a real compile).
	if (!(TARGETS[key].magic as readonly string[]).some((prefix) => found.startsWith(prefix))) {
		result.gaps.push({
			what: "container",
			detail: `${name} starts ${found}, expected ${TARGETS[key].magic.join(" or ")} for ${TARGETS[key].os}`,
		});
		return result;
	}
	const sha = new Bun.CryptoHasher("sha256")
		.update(await Bun.file(join(dir, name)).arrayBuffer())
		.digest("hex");

	// Only this machine's own target can be executed; a cross asset is proven by its
	// container and its bytes. `gh release download` writes 0644, so the probe needs the
	// exec bit first or it dies EACCES and reads as a broken binary.
	if (key === host) {
		await chmod(join(dir, name), 0o755);
		const probe = Bun.spawnSync([join(dir, name), "--version"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const printed = probe.stdout.toString().trim();
		if (probe.exitCode === 0 && printed === VERSION) {
			result.lines.push(
				`  PASS  ${name.padEnd(34)}${info.size.toLocaleString()} bytes  ran --version ${printed}`,
			);
		} else {
			result.gaps.push({
				what: "run",
				detail: `${name} exited ${probe.exitCode}, printed ${JSON.stringify(printed)}, wanted ${VERSION}`,
			});
		}
	} else {
		result.lines.push(
			`  PASS  ${name.padEnd(34)}${info.size.toLocaleString()} bytes  ${found}  not executed (${key} on ${host ?? "unknown"})`,
		);
	}
	result.lines.push(`        sha256 ${sha}`);
	return result;
}
