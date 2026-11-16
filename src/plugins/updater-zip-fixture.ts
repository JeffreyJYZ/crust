/**
 * A real zip writer for the updater suite: a signed archive has to be a genuine zip, or the test
 * proves nothing about the reader it exercises. Stored and deflated entries, the unix mode in the
 * central directory, symlinks as link targets — the four things a bundle archive actually uses.
 * CRC32 is written for real, so the fixture opens in any zip tool as well as in `readArchive`.
 */

export interface ZipSpec {
	/** The entry's path inside the archive; a trailing `/` makes it a directory. */
	name: string;
	/** A file's content. Ignored when `link` is set. */
	body?: string;
	/** Unix permission bits, e.g. `0o755`. */
	mode?: number;
	/** Deflate this entry instead of storing it. */
	deflate?: boolean;
	/** Write the entry as a symlink pointing at this target. */
	link?: string;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

class Writer {
	readonly bytes: number[] = [];

	u16(value: number): void {
		this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
	}

	u32(value: number): void {
		this.u16(value & 0xffff);
		this.u16((value >>> 16) & 0xffff);
	}

	raw(chunk: Uint8Array): void {
		for (const byte of chunk) this.bytes.push(byte);
	}

	get length(): number {
		return this.bytes.length;
	}
}

const encoder = new TextEncoder();
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Build a zip from `specs`, in the order given. */
export function buildZip(specs: readonly ZipSpec[]): Uint8Array {
	const out = new Writer();
	const directory: Array<{
		spec: ZipSpec;
		offset: number;
		size: number;
		crc: number;
		method: number;
	}> = [];
	for (const spec of specs) {
		const name = encoder.encode(spec.name);
		const body = encoder.encode(spec.link ?? spec.body ?? "");
		const method = spec.deflate === true ? 8 : 0;
		const data = method === 8 ? Bun.deflateSync(body, { windowBits: -15 }) : body;
		const crc = crc32(body);
		const offset = out.length;
		out.u32(LOCAL);
		out.u16(20);
		out.u16(0);
		out.u16(method);
		out.u16(0);
		out.u16(0);
		out.u32(crc);
		out.u32(data.length);
		out.u32(body.length);
		out.u16(name.length);
		out.u16(0);
		out.raw(name);
		out.raw(data);
		directory.push({ spec, offset, size: data.length, crc, method });
	}
	const start = out.length;
	for (const entry of directory) {
		const name = encoder.encode(entry.spec.name);
		const body = encoder.encode(entry.spec.link ?? entry.spec.body ?? "");
		const type = entry.spec.link !== undefined ? 0o120000 : 0o100000;
		out.u32(CENTRAL);
		out.u16(0x031e);
		out.u16(20);
		out.u16(0);
		out.u16(entry.method);
		out.u16(0);
		out.u16(0);
		out.u32(entry.crc);
		out.u32(entry.size);
		out.u32(body.length);
		out.u16(name.length);
		out.u16(0);
		out.u16(0);
		out.u16(0);
		out.u16(0);
		out.u32(((type | (entry.spec.mode ?? 0o644)) & 0xffff) << 16);
		out.u32(entry.offset);
		out.raw(name);
	}
	const size = out.length - start;
	out.u32(END);
	out.u16(0);
	out.u16(0);
	out.u16(directory.length);
	out.u16(directory.length);
	out.u32(size);
	out.u32(start);
	out.u16(0);
	return Uint8Array.from(out.bytes);
}

/** The entries of a small bundle: a marker, an executable, and a framework symlink. */
export function bundleZip(name = "Notes.app", marker = "new"): Uint8Array {
	return buildZip([
		{ name: `${name}/`, mode: 0o755 },
		{ name: `${name}/Contents/`, mode: 0o755 },
		{ name: `${name}/Contents/marker.txt`, body: marker },
		{ name: `${name}/Contents/MacOS/`, mode: 0o755 },
		{ name: `${name}/Contents/MacOS/Notes`, body: "#!/bin/sh\n", mode: 0o755, deflate: true },
		{ name: `${name}/Contents/Versions/`, mode: 0o755 },
		{ name: `${name}/Contents/Versions/A/`, mode: 0o755 },
		{ name: `${name}/Contents/Versions/Current`, link: "A" },
	]);
}
