/**
 * The AppImage proof's fixture: a scratch copy of `examples/hello` with the icon `crust package
 * --format appimage` requires, and the names the example's own manifest decides. Nothing here
 * guesses an id, a version or an artefact name — they come from the config the build reads.
 */
import { cp, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { EXAMPLE_DIR, FALLBACK_DEPENDENCY } from "../fixture.ts";

/** A 105 MiB binary packs to ~47 MiB, so this is a stub detector, never a size guess. */
export const MIN_APPIMAGE_BYTES = 10 * 1024 * 1024;

/** The size the AppImage layout names; the builder copies the PNG as-is, resampling nothing. */
const ICON_PIXELS = 512;

/** Where the staged project, its artefact and the names that artefact carries live. */
export interface Staged {
	scratch: string;
	dist: string;
	image: string;
	id: string;
	name: string;
	version: string;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.byteLength);
	const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
	const sum = Buffer.alloc(4);
	sum.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, sum]);
}

/** A solid-colour PNG, so the fixture ships no binary asset and no `sips` is needed to make one. */
export function iconPng(size = ICON_PIXELS): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // truecolour
	const raw = Buffer.alloc(size * (size * 3 + 1));
	for (let row = 0; row < size; row++) {
		const start = row * (size * 3 + 1);
		for (let x = 0; x < size; x++) {
			const at = start + 1 + x * 3;
			raw[at] = 0x1f;
			raw[at + 1] = 0x8a;
			raw[at + 2] = 0xee;
		}
	}
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array()),
	]);
}

/** The example's manifest as data, with the icon added — one source for id, name and version. */
async function exampleConfig(): Promise<{
	app: { id: string; name: string; version: string; icon?: string };
}> {
	const path = join(EXAMPLE_DIR, "crust.config.ts");
	return (await import(path)).default as { app: { id: string; name: string; version: string } };
}

/** Copy the example, add the icon its config now names, and say where the artefact will land. */
export async function stageProject(scratch: string): Promise<Staged> {
	const example = await exampleConfig();
	const config = { ...example, app: { ...example.app, icon: "icon.png" } };

	await mkdir(join(scratch, "node_modules"), { recursive: true });
	await symlink(FALLBACK_DEPENDENCY, join(scratch, "node_modules", "crust"), "dir");
	for (const name of ["main.ts", "public"]) {
		await cp(join(EXAMPLE_DIR, name), join(scratch, name), { recursive: true });
	}
	await writeFile(
		join(scratch, "crust.config.ts"),
		`import type { CrustConfig } from "crust";\n\n` +
			`export default ${JSON.stringify(config, null, "\t")} satisfies CrustConfig;\n`,
		"utf8",
	);
	await writeFile(join(scratch, "icon.png"), iconPng());

	const { id, name, version } = config.app;
	const dist = join(scratch, "dist");
	return { scratch, dist, image: join(dist, `${id}-${version}.AppImage`), id, name, version };
}

/** Every `.AppImage` in `dir`, sorted — the set a second run must not grow. */
export async function listAppImages(dir: string): Promise<string[]> {
	const entries = await readdir(dir).catch(() => [] as string[]);
	return entries.filter((name) => name.endsWith(".AppImage")).sort();
}
