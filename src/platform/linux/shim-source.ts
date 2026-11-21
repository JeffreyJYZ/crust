/**
 * The Linux shim, as one compilation unit assembled from parts. It must stay one unit: the parts share the error buffer and the window slot table, and none carries an `#include` — every GTK and WebKit entry point is a hand-written prototype resolved through `dlopen` — so the order below is load-bearing, not layout.
 * Parts are numbered because the unit reads top to bottom: the prelude opens both libraries and forward-declares the three resolve functions the later parts define.
 */
import prelude from "./shim/10_prelude.c" with { type: "text" };
import webview from "./shim/30_webview.c" with { type: "text" };
import browser from "./shim/31_browser.c" with { type: "text" };
import viewState from "./shim/32_view_state.c" with { type: "text" };
import window from "./shim/40_window.c" with { type: "text" };
import container from "./shim/41_container.c" with { type: "text" };
import host from "./shim/42_host.c" with { type: "text" };
import windowApi from "./shim/45_window_api.c" with { type: "text" };
import windowStateApi from "./shim/46_window_state_api.c" with { type: "text" };
import pump from "./shim/50_pump.c" with { type: "text" };
import screen from "./shim/60_screen.c" with { type: "text" };
import keyring from "./shim/70_keyring.c" with { type: "text" };
import clipboard from "./shim/80_clipboard.c" with { type: "text" };
import opener from "./shim/81_opener.c" with { type: "text" };
import osInfo from "./shim/82_osinfo.c" with { type: "text" };
import dialog from "./shim/83_dialog.c" with { type: "text" };
import dialogCalls from "./shim/84_dialog_calls.c" with { type: "text" };
import snapshot from "./shim/90_snapshot.c" with { type: "text" };

/** The parts, in the only order that compiles. */
export const SHIM_PARTS = [
	prelude,
	webview,
	// The browser surface's two policies, right after the part that defines the signal connector and
	// the bounded copy they use — both are statics in `30_webview.c`, and a later part sees them.
	browser,
	// The per-view load and eval records, keyed by the handle the commands carry. They follow the
	// webview part because its signal handlers are connected at creation and its eval finish lives
	// there; the parts are one translation unit, so a later part sees those statics.
	viewState,
	window,
	// The positioned container, after the window part because it uses that part's `gtk_container_add`
	// and size-request pointers, and before the window API because nothing there needs it.
	container,
	// The surface's GtkFixed wrapper, after the container part that binds the GTK pointers it uses.
	host,
	windowApi,
	windowStateApi,
	pump,
	screen,
	keyring,
	// The three namespaces a normal app reaches first. Last, because each resolves its own entry
	// points lazily from the handle the prelude opened — nothing here is needed before a command.
	clipboard,
	opener,
	osInfo,
	dialog,
	dialogCalls,
	// WebKitGTK's async snapshot, last because it reads the webview part's GLib function pointers
	// and the prelude's handles. Its entry points resolve lazily, so an older WebKit fails only
	// `shim_snapshot_ready` rather than the launch.
	snapshot,
] as const;

/**
 * The whole unit. Joined with a newline because every part ends at a line boundary
 * and a missing separator would weld two declarations together.
 */
export const shimSource = SHIM_PARTS.join("\n");

/** Repo-relative paths, in the same order, for a doctor's on-disk and embedded checks. */
export const SHIM_PART_PATHS = [
	"src/platform/linux/shim/10_prelude.c",
	"src/platform/linux/shim/30_webview.c",
	"src/platform/linux/shim/31_browser.c",
	"src/platform/linux/shim/32_view_state.c",
	"src/platform/linux/shim/40_window.c",
	"src/platform/linux/shim/41_container.c",
	"src/platform/linux/shim/42_host.c",
	"src/platform/linux/shim/45_window_api.c",
	"src/platform/linux/shim/46_window_state_api.c",
	"src/platform/linux/shim/50_pump.c",
	"src/platform/linux/shim/60_screen.c",
	"src/platform/linux/shim/70_keyring.c",
	"src/platform/linux/shim/80_clipboard.c",
	"src/platform/linux/shim/81_opener.c",
	"src/platform/linux/shim/82_osinfo.c",
	"src/platform/linux/shim/83_dialog.c",
	"src/platform/linux/shim/84_dialog_calls.c",
	"src/platform/linux/shim/90_snapshot.c",
] as const;

/** The same list as bare file names, for callers that already know the directory. */
export const SHIM_PART_NAMES = SHIM_PART_PATHS.map((path) => path.slice(path.lastIndexOf("/") + 1));
