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

const text = await Bun.file(PAGE).text();
const rows = text
	.split("\n")
	.filter((line) => line.startsWith("| ") && !line.startsWith("| Tauri") && !line.startsWith("| ---"))
	.map((line) => line.split("|")[1]?.trim() ?? "")
	.filter((cell) => cell.length > 0);

const seen = new Set(rows.map((row) => row.toLowerCase()));
const missing = OFFICIAL.filter((feature) => !seen.has(feature.toLowerCase()));
const extra = rows.filter(
	(row) => !OFFICIAL.some((feature) => feature.toLowerCase() === row.toLowerCase()),
);

console.log(`parity rows: ${rows.length}  official: ${OFFICIAL.length}`);
if (missing.length > 0) {
	console.log(`MISSING ${missing.length}: ${missing.join(", ")}`);
}
if (extra.length > 0) {
	console.log(`unlisted ${extra.length}: ${extra.join(", ")}`);
}
console.log(missing.length === 0 ? "check:parity  PASS" : "check:parity  FAIL");
process.exit(missing.length === 0 ? 0 : 1);
