/**
 * `--format` values and their defaults. Parsing lives here so a bad value is a
 * usage error before any builder runs, and a repeated format is built once.
 */

export const FORMATS = ["dmg", "appimage", "nsis"] as const;
export type PackageFormat = (typeof FORMATS)[number];

export type FormatParse = { ok: true; formats: PackageFormat[] } | { ok: false; error: string };

export function isFormat(value: string): value is PackageFormat {
	return (FORMATS as readonly string[]).includes(value);
}

/** No `--format` at all means `dmg`, the only artefact this machine can build unaided. */
export function parseFormats(values: string[]): FormatParse {
	if (values.length === 0) return { ok: true, formats: ["dmg"] };

	const formats: PackageFormat[] = [];
	for (const value of values) {
		if (!isFormat(value)) {
			return {
				ok: false,
				error: `unknown format "${value}" — expected ${FORMATS.join(" | ")}`,
			};
		}
		if (!formats.includes(value)) formats.push(value);
	}
	return { ok: true, formats };
}
