/**
 * The five targets a release ships, named once: `build-standalone.ts` compiles them and
 * `scripts/release/assets.ts` checks them, and two copies of this table drift the first
 * time one of them gains a platform. `magic` is a binary's first bytes, which is the only
 * way to prove the OS of an asset this machine cannot execute.
 */
import packageJson from "../../package.json";

export const TARGETS = {
	"bun-darwin-arm64": { os: "darwin", arch: "arm64", magic: ["cffaedfe", "cafebabe"] },
	"bun-darwin-x64": { os: "darwin", arch: "x64", magic: ["cffaedfe", "cafebabe"] },
	"bun-linux-x64": { os: "linux", arch: "x64", magic: ["7f454c46"] },
	"bun-linux-arm64": { os: "linux", arch: "arm64", magic: ["7f454c46"] },
	"bun-windows-x64": { os: "windows", arch: "x64", magic: ["4d5a"] },
} as const;

export type Target = keyof typeof TARGETS;

/** The version is never written down: it is `package.json`'s, and a release tag must name it. */
export const VERSION: string = packageJson.version;

/** A human picks an asset by name, so the name carries the version, the OS and the arch. */
export function artifactName(target: Target): string {
	const { os, arch } = TARGETS[target];
	return `crust-${VERSION}-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
}

/** The target this machine builds natively and can therefore also execute. */
export function hostTarget(): Target | undefined {
	// `process.platform` says `win32` and the release table says `bun-windows-x64`, so the
	// key is not always `bun-<platform>-<arch>`: Windows was the one that never lined up, and
	// a release job passing `--target bun-windows-x64` died on "no release target for
	// win32-x64" before it compiled anything (2026-11-17).
	const platform = process.platform === "win32" ? "windows" : process.platform;
	const key = `bun-${platform}-${process.arch}`;
	return key in TARGETS ? (key as Target) : undefined;
}
