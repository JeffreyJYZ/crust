/**
 * PNG -> `icon.icns` using only `sips` and `iconutil`.
 *
 * No dependency, no `node-gyp`, no ImageMagick. Both tools ship with macOS and
 * both are cheap enough that regenerating an icon on every build is not worth
 * caching.
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runOrThrow } from "./exec";

/** Apple's icon set is 16..1024 in points, each with a 2x cut. */
const ICONSET: ReadonlyArray<{ name: string; pixels: number }> = [
	{ name: "icon_16x16.png", pixels: 16 },
	{ name: "icon_16x16@2x.png", pixels: 32 },
	{ name: "icon_32x32.png", pixels: 32 },
	{ name: "icon_32x32@2x.png", pixels: 64 },
	{ name: "icon_128x128.png", pixels: 128 },
	{ name: "icon_128x128@2x.png", pixels: 256 },
	{ name: "icon_256x256.png", pixels: 256 },
	{ name: "icon_256x256@2x.png", pixels: 512 },
	{ name: "icon_512x512.png", pixels: 512 },
	{ name: "icon_512x512@2x.png", pixels: 1024 },
];

/** A source below this cannot supply `icon_512x512@2x.png` honestly. */
export const MINIMUM_ICON_PIXELS = 1024;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface IcnsOptions {
	/** Source PNG. Must be at least 1024x1024. */
	source: string;
	/** Destination `.icns` path. Parent directory is created if missing. */
	out: string;
}

export interface IcnsResult {
	icnsPath: string;
	bytes: number;
	/** Source dimensions, so a caller can report what it converted. */
	width: number;
	height: number;
}

/**
 * Read width/height straight out of the PNG IHDR chunk.
 *
 * `sips -g pixelWidth` would work too, but it is a process spawn and it fails
 * with a much less useful message on a non-PNG. Twenty-four bytes are enough:
 * 8 signature bytes, the 4-byte chunk length, "IHDR", then width and height as
 * big-endian uint32.
 */
function readPngSize(data: Uint8Array, source: string): { width: number; height: number } {
	if (data.byteLength < 24) {
		throw new Error(`${source} is not a PNG: only ${data.byteLength} bytes`);
	}
	const wrong = PNG_SIGNATURE.findIndex((byte, index) => data[index] !== byte);
	if (wrong !== -1) {
		throw new Error(`${source} is not a PNG: bad signature byte ${wrong}`);
	}
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Convert a PNG to an `.icns`, or fail with the actual dimensions.
 *
 * The 1024 floor is not a nicety: `icon_512x512@2x.png` is 1024 pixels, so a
 * smaller source has to be upscaled and macOS then shows a soft icon at every
 * size. Failing here is the only clear outcome; a silently upscaled icon ships.
 */
export async function pngToIcns(options: IcnsOptions): Promise<IcnsResult> {
	const data = new Uint8Array(await Bun.file(options.source).arrayBuffer());
	const { width, height } = readPngSize(data, options.source);

	if (width < MINIMUM_ICON_PIXELS || height < MINIMUM_ICON_PIXELS) {
		throw new Error(
			`icon ${options.source} is ${width}x${height}; need at least ${MINIMUM_ICON_PIXELS}x${MINIMUM_ICON_PIXELS} ` +
				`because icon_512x512@2x.png is ${MINIMUM_ICON_PIXELS} pixels. Supply a larger source.`,
		);
	}

	const iconset = `${options.out}.iconset`;
	await mkdir(iconset, { recursive: true });
	await mkdir(dirname(options.out), { recursive: true });

	try {
		for (const entry of ICONSET) {
			await runOrThrow([
				"sips",
				"-z",
				String(entry.pixels),
				String(entry.pixels),
				options.source,
				"--out",
				join(iconset, entry.name),
			]);
		}
		await runOrThrow(["iconutil", "-c", "icns", iconset, "-o", options.out]);
	} finally {
		// The .iconset is an intermediate; leaving it behind doubles the icon cost
		// and pollutes Resources/ if the caller ever points `out` inside the bundle.
		await rm(iconset, { recursive: true, force: true });
	}

	const bytes = (await Bun.file(options.out).stat()).size;
	return { icnsPath: options.out, bytes, width, height };
}
