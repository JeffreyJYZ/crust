/**
 * Helpers, skip constants and the child harness source for the live Butter sweep, split out of
 * `butter-sweep-commands.ts` and `butter-sweep.test.ts` for the 200-line cap. The case table itself —
 * every case and every skip reason — stays in `butter-sweep-commands.ts`; the assertions stay in
 * `butter-sweep.test.ts`. This file holds the shapes, values and child source those two name.
 */

export interface SweepCase {
	/** `plugin.command`, exactly as a page would invoke it. */
	command: string;
	/** Arguments, or undefined for a command that takes none. */
	args?: unknown;
	/**
	 * The window label the bridge would attach to this request. `window.label` is the one command
	 * whose whole answer *is* that label, so it needs one or it refuses for a reason that says so.
	 */
	window?: string;
	/** Set only when the command must not be driven; the text is why. */
	skip?: string;
}

export const NO_PERSON =
	"needs a person in front of the machine (a permission prompt or a system dialog), so a runner " +
	"cannot answer it; the plugin suite covers its refusal path instead";

/**
 * The other skip reasons, named so the case table stays one line per case. The text is unchanged:
 * each reason is a decision about what a runner must not do on a person's machine.
 */
export const NOTIFICATION_PERMISSION =
	"by design the notification itself raises the prompt, so this command refuses on purpose and always";
export const OPENER_URL = "launches the default browser, which a headless runner must not do";
export const OPENER_REVEAL =
	"opens a Finder window and steals focus from the person using the machine";
export const OPENER_PATH = "hands a path to LaunchServices, which may open any registered app";
export const UPDATER_INSTALL =
	"replaces the running bundle on disk, which would leave the sweep swapping its own app";
export const UPDATER_RELAUNCH =
	"re-executes the app, which kills the test runner before it can report";
export const MENU_CONTEXT = "opens a modal context menu that blocks until a person dismisses it";
export const DOWNLOADS_START =
	"starts a real network download into the app data root, which a runner must not touch";
export const SINGLE_INSTANCE =
	"the runtime claims this lock at launch and the runner holds it; a release here would free the harness's own claim";
export const AUTOSTART_ENABLE =
	"writes a RunAtLoad plist into the user's real ~/Library/LaunchAgents, which would add a login item on this machine; e2e:parity proves the write against a temp home";

/** Where the sweep writes its i18n catalogue; the runner creates it beside the case table. */
export const LOCALES_DIR = ".sweep-tmp/locales";

/**
 * `clipboard.writeImage` takes real bytes, and a JSON case table cannot carry a Uint8Array — so a
 * case names this marker and the child substitutes a 1×1 transparent PNG. The smallest real PNG is
 * what makes the write a pasteboard write rather than a shape check.
 */
export const PNG_MARKER = "sweep-png";

/**
 * `database.open` mints the handle (`db-1`, `db-2`, …), so a JSON case table cannot name it ahead of
 * time. A case uses this marker as its `handle` and the child substitutes the value `open` returned;
 * naming the file's `name` instead answers `unknown-handle` and proves nothing about the statement.
 */
export const DB_HANDLE_MARKER = "last-db";

/**
 * An obscure hot key, registered then released by the sweep so no combination a person uses is
 * swallowed. `f19` with three modifiers is outside every common binding.
 */
export const SWEEP_SHORTCUT = "control+option+shift+f19";

/**
 * A bundle id that cannot own a real LaunchAgent, so the two safe autostart commands (a read and a
 * forced removal) touch no login item on the machine running the sweep.
 */
export const SWEEP_BUNDLE_ID = "dev.crust.sweep.probe.absent";

/**
 * The child: real platform, real plugins from `nativePlugins`, then one `handle()` per case. The
 * harness and the case table are written into the temp dir so the child needs no bundler.
 */
export function childScript(casesPath: string): string {
	return `
import { DarwinPlatform } from "./src/platform/darwin/platform.ts";
import { nativePlugins } from "./src/runtime-plugins.ts";
import { corePlugins } from "./src/plugins/core.ts";

/** A 1x1 transparent PNG so the image write carries real bytes. */
const SWEEP_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
// A typed { ok: false, code } failure is a refusal when the code names a condition the harness
// cannot satisfy: a capability absent on this platform, or a native half the runtime lacks.
// These are the codes failure-status.ts maps onto 501, plus not-implemented itself. A real answer
// (a command that ran and rejected the caller's arguments) must stay a pass.
// page-cannot-clear is deliberately NOT here: crash-reporter.clear refuses every page caller by
// design, only the runtime may delete evidence, so no argument the harness passes could answer
// it; the command still ran and answered, which is exactly what the sweep proves.
const REFUSAL_CODES = new Set([
  "not-implemented",
  "unsupported-platform",
  "unknown-adapter",
  "not-an-app-bundle",
]);
const isRefusal = (answer) => {
  if (typeof answer !== "object" || answer === null) return false;
  if (typeof answer.code === "string" && REFUSAL_CODES.has(answer.code)) return true;
  return answer.code === undefined && typeof answer.message === "string" && answer.requires !== undefined;
};

// activate "always", because AppKit answers AXWindows only for a window on the active Space:
// with "never" the app stays inactive, AX lists no windows, and elementCount correctly
// refuses — a real answer, but it would read as a gap in the sweep.
const platform = new DarwinPlatform({ appName: "crust-butter-sweep", activate: "always" });
await platform.start();
platform.createWindow({ label: "main", title: "sweep", url: "about:blank", width: 480, height: 320 });
platform.pump(16);
// The webview is built on the platform's own queue; without this a webview command answers
// "no window" and would read like a gap rather than a wait.
await Bun.sleep(500);

const plugins = await nativePlugins(corePlugins, platform, {
  app: "crust.butter.sweep",
  shell: { allow: ["sh"] },
});
const byName = new Map(plugins.map((p) => [p.name, p]));
const ctx = { emit: () => {} };
const cases = JSON.parse(await Bun.file(${JSON.stringify(casesPath)}).text());
// database.open mints a handle (db-1, db-2, …); later cases name it through a marker so they drive
// the real handle instead of a made-up name the plugin would refuse as unknown-handle.
let lastDbHandle;

for (const entry of cases) {
  if (entry.skip) continue;
  const dot = entry.command.indexOf(".");
  const pluginName = entry.command.slice(0, dot);
  const commandName = entry.command.slice(dot + 1);
  const plugin = byName.get(pluginName);
  if (!plugin) {
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "NO-PLUGIN" }));
    continue;
  }
  const handler = plugin.commands[commandName];
  if (typeof handler !== "function") {
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "NO-COMMAND" }));
    continue;
  }
  /**
   * The page-facing byte array for a command arg. The bridge revives a binary argument into a
   * Uint8Array, and a case table written as JSON has no way to express one — so a case may name a
   * marker string and the child substitutes it here.
   */
  const revive = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.__bytes === "sweep-png") return SWEEP_PNG;
      if (value.__handle === "last-db") return lastDbHandle;
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = revive(v);
      return out;
    }
    if (Array.isArray(value)) return value.map(revive);
    return value;
  };

  let answer;
  try {
    // The bridge attaches the caller's window to every request; a direct handler call has to add it
    // itself, or window.label refuses for want of the identity it exists to report.
    const request = entry.window === undefined ? ctx : { ...ctx, window: entry.window };
    answer = await handler(revive(entry.args), request);
  } catch (error) {
    // A throw is a run: the command was reached and refused for a reason it named. The sweep's
    // subject is a hollow row, which answers not-implemented instead of throwing.
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "threw" }));
    continue;
  }
  if (entry.command === "database.open" && answer && answer.ok === true && typeof answer.handle === "string") {
    lastDbHandle = answer.handle;
  }
  console.log(JSON.stringify({ command: entry.command, refusal: isRefusal(answer), detail: isRefusal(answer) ? JSON.stringify(answer).slice(0, 120) : "ok" }));
}

platform.stopPump();
process.exit(0);
`;
}
