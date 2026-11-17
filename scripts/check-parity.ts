#!/usr/bin/env bun
/**
 * Does the parity page actually cover Tauri's official macOS list?
 *
 * The matrix is hand-written, so "0 missing" is only as good as the person who
 * typed it. This pins the official feature names and fails when one has no row —
 * which is how Stronghold, persisted scope, store, upload and CLI were absent
 * for two revisions without anything noticing.
 *
 * Source: https://tauri.app/plugin/ (official features) plus the core API
 * modules Tauri ships outside the plugin list.
 */
const OFFICIAL = [
	// Tauri's official feature list, macOS-capable entries.
	"Autostart",
	"Clipboard",
	"Command line (CLI)",
	"Deep linking",
	"Dialog",
	"File system",
	"Global shortcut",
	"HTTP client",
	"Localhost server",
	"Logging",
	"Notifications",
	"Opener",
	"OS information",
	"Persisted scope",
	"Positioner",
	"Process",
	"Shell",
	"Single instance",
	"SQL",
	"Store",
	"Stronghold",
	"Updater",
	"Upload",
	"WebSocket",
	"Window state",
	// Core surfaces Tauri documents outside the plugin list.
	"Windows",
	"Webviews",
	"Menus",
	"Tray",
	"Events",
	"Path",
	"DPI, image",
] as const;

/** Mobile-only in Tauri, so they are not rows: barcode, biometric, geolocation, haptics, NFC. */
const PAGE = "site/app/docs/reference/parity/page.mdx";

/**
 * Framework guarantees, not plugin surfaces. This list exists because the sweep went green while
 * the capability model was missing entirely: `OFFICIAL` is Tauri's *plugin* list, and security is
 * not a plugin there — it is a framework-level concept, so a matrix of callable surfaces could not
 * show its absence. A concept may be answered `absent`; what it may not do is have no row.
 */
const CONCEPTS = [
	"Security / capabilities",
	"CSP",
	"Isolation pattern",
	"IPC transport",
	"Command authorisation",
	"Updater signing",
] as const;

const text = await Bun.file(PAGE).text();
const rows = text
	.split("\n")
	.filter(
		(line) => line.startsWith("| ") && !line.startsWith("| Tauri") && !line.startsWith("| ---"),
	)
	.map((line) => line.split("|")[1]?.trim() ?? "")
	.filter((cell) => cell.length > 0);

const seen = new Set(rows.map((row) => row.toLowerCase()));
const missing = OFFICIAL.filter((feature) => !seen.has(feature.toLowerCase()));
/**
 * A concept row may answer `absent` — that is an honest answer. It may not be missing, because a
 * row that does not exist is indistinguishable from a guarantee nobody thought to check.
 */
const missingConcepts = CONCEPTS.filter((concept) => !seen.has(concept.toLowerCase()));
const extra = rows.filter(
	(row) =>
		!OFFICIAL.some((feature) => feature.toLowerCase() === row.toLowerCase()) &&
		!CONCEPTS.some((concept) => concept.toLowerCase() === row.toLowerCase()),
);

console.log(
	`parity rows: ${rows.length}  official: ${OFFICIAL.length}  concepts: ${CONCEPTS.length}`,
);
if (missing.length > 0) {
	console.log(`MISSING ${missing.length}: ${missing.join(", ")}`);
}
if (missingConcepts.length > 0) {
	console.log(`MISSING CONCEPT ${missingConcepts.length}: ${missingConcepts.join(", ")}`);
}
if (extra.length > 0) {
	console.log(`unlisted ${extra.length}: ${extra.join(", ")}`);
}
const failed = missing.length > 0 || missingConcepts.length > 0;
console.log(failed ? "check:parity  FAIL" : "check:parity  PASS");
process.exit(failed ? 1 : 0);
