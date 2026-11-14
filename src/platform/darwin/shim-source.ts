/**
 * The AppKit shim, as one compilation unit assembled from parts.
 *
 * The C is a single translation unit on purpose: every part shares statics
 * (`panel_paths`, `panel_sheet_panel`, the sheet block) and the parts carry no
 * `#include` at all — every Objective-C symbol is a hand-written `extern`, which is
 * what lets TinyCC compile it with no SDK. So the order below is load-bearing: it is
 * the order the parts had before the split, and joining it any other way changes
 * meaning, not just layout.
 *
 * Parts are numbered because the unit reads top to bottom. `arity.test.ts` composes
 * the same files from disk, in path order, so the numbers and this list must agree.
 */
import prelude from "./shim/10_prelude.c" with { type: "text" };
import sends from "./shim/20_sends.c" with { type: "text" };
import webview from "./shim/30_webview.c" with { type: "text" };
import window from "./shim/40_window.c" with { type: "text" };
import app from "./shim/50_app.c" with { type: "text" };
import panels from "./shim/60_panels.c" with { type: "text" };
import sheetBlock from "./shim/70_sheet_block.c" with { type: "text" };
import openPanel from "./shim/75_open_panel.c" with { type: "text" };
import savePanel from "./shim/80_save_panel.c" with { type: "text" };
import sheetResult from "./shim/85_sheet_result.c" with { type: "text" };

/** The parts, in the only order that compiles. */
export const SHIM_PARTS = [
	prelude,
	sends,
	webview,
	window,
	app,
	panels,
	sheetBlock,
	openPanel,
	savePanel,
	sheetResult,
] as const;

/**
 * The whole unit. Joined with a newline because every part ends at a line boundary
 * and a missing separator would weld two declarations together.
 */
export const shimSource = SHIM_PARTS.join("\n");

/** Repo-relative paths, in the same order, for the doctor's on-disk and embedded checks. */
export const SHIM_PART_PATHS = [
	"src/platform/darwin/shim/10_prelude.c",
	"src/platform/darwin/shim/20_sends.c",
	"src/platform/darwin/shim/30_webview.c",
	"src/platform/darwin/shim/40_window.c",
	"src/platform/darwin/shim/50_app.c",
	"src/platform/darwin/shim/60_panels.c",
	"src/platform/darwin/shim/70_sheet_block.c",
	"src/platform/darwin/shim/75_open_panel.c",
	"src/platform/darwin/shim/80_save_panel.c",
	"src/platform/darwin/shim/85_sheet_result.c",
] as const;

/** The same list as bare file names, for callers that already know the directory. */
export const SHIM_PART_NAMES = SHIM_PART_PATHS.map((path) => path.slice(path.lastIndexOf("/") + 1));
