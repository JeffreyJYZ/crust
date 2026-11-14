/**
 * What a run must observe: every answer tag in order, every assertion name, and
 * the one line that proves the app ended itself.
 */

/**
 * Every answer the page sends, in order. The count is the guard against a
 * silent no-op: a page that never ran, or died half way, cannot reach it.
 */
export const EXPECTED_TAGS = [
	"list0",
	"main0",
	"other0",
	"ghost",
	"title",
	"titlebad",
	"focus1",
	"focus2",
	"focusother",
	"focusghost",
	"list1",
	"unknown",
	"badlabel",
	"alive",
	"createrel",
	"createabs",
	"sawrelative",
	"child.relative",
	"sawabsolute",
	"child.absolute",
	"lists2",
	"childopen",
	"childtitle",
	"childclose",
	"childgone",
	"absclose",
	"absgone",
	"tidied",
	"closemain",
	"mainafter",
	"otherstill",
	"released",
	"recreate",
	"sawreopen",
	"child.main",
	"relist",
	"reopenopen",
	"reopenset",
	"dup",
	"duplist",
	"dupafter",
	"create",
	"lists",
	"spawnopen",
	"spawnset",
	"spawnclose",
	"spawngone",
	"badsize",
	"badfraction",
	"badurl",
	"reflist",
	"closeagain",
	"maingone",
	"closing",
] as const;

/**
 * The assertions that read those answers, in one place: a build that never ran
 * must report each of them as unchecked, and a drifted name must not silently
 * vanish from that list.
 */
export const WINDOW_CHECKS = [
	"list open",
	"isOpen main",
	"isOpen other",
	"ghost absent",
	"isOpen ghost",
	"setTitle",
	"setTitle bad",
	"focus",
	"focus twice",
	"focus other",
	"focus ghost",
	"after focus",
	"unknown cmd",
	"bad label",
	"alive after",
	"create relative",
	"child relative",
	"create absolute",
	"child absolute",
	"child waited",
	"list children",
	"child open",
	"child title",
	"child close",
	"child gone",
	"absolute close",
	"absolute gone",
	"tidy",
	"close main",
	"isOpen closed",
	"other still",
	"released",
	"recreate",
	"reopen loads",
	"relist",
	"reopen open",
	"reopen title",
	"duplicate",
	"duplicate list",
	"duplicate kept",
	"create",
	"list after create",
	"spawn open",
	"spawn title",
	"spawn close",
	"spawn gone",
	"bad size",
	"bad fraction",
	"bad url",
	"refused nothing",
	"close again",
	"close again gone",
	"all closed",
	"exit 0",
	"no survivors",
] as const;

/** The backend's own line once every window is closed. */
export const ALL_CLOSED = /window\s+every window closed; quitting/;

/**
 * Nothing. The app ends itself, so the probe must not stop it on a line: anything matching would get a SIGTERM and `exit 0` would be a fact about the harness, not about `window-all-closed`. `(?!)/` can never match, so the probe waits for the child's own exit; `/$^/` is unsafe because it matches an empty string and would end the probe on an empty first chunk.
 */
export const WAIT_FOR_EXIT = /(?!)/;

/**
 * Two windows plus WebKit's web processes, four created windows and the shim
 * compile; measured ~3 s. The headroom covers the pages' own report waits, which
 * only run long when something is already broken.
 */
export const APP_TIMEOUT_MS = 40_000;
