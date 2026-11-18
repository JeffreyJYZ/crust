/**
 * Shapes, skip constants and the child source for the live Butter sweep, split out of
 * `butter-sweep-commands.ts` and `butter-sweep.test.ts` for the 200-line cap. The case table stays in
 * `butter-sweep-commands.ts`; the assertions stay in `butter-sweep.test.ts`.
 */

export interface SweepCase {
	/** `plugin.command`, exactly as a page would invoke it. */
	command: string;
	/** Arguments, or undefined for a command that takes none. */
	args?: unknown;
	/** `window.label` needs a label or it refuses for want of the identity it exists to report. */
	window?: string;
	/** Set only when the command must not be driven; the text is why. */
	skip?: string;
}

export const NO_PERSON =
	"needs a person in front of the machine (a permission prompt or a system dialog), so a runner " +
	"cannot answer it; the plugin suite covers its refusal path instead";

/** Skip reasons named so the case table stays one line per case: what a runner must not do. */
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
 * `clipboard.writeImage` takes real bytes, so a JSON case cannot carry them: this marker makes the
 * child substitute a 1x1 transparent PNG, the smallest real pasteboard write.
 */
export const PNG_MARKER = "sweep-png";

/**
 * `database.open` mints the handle (`db-1`, …), so a JSON case cannot name it ahead of time. The child
 * substitutes the value `open` returned; naming the file's `name` answers `unknown-handle`.
 */
export const DB_HANDLE_MARKER = "last-db";

/** An obscure hot key, registered then released, so no common binding is swallowed. */
export const SWEEP_SHORTCUT = "control+option+shift+f19";

/** A bundle id that cannot own a real LaunchAgent, so autostart touches no login item. */
export const SWEEP_BUNDLE_ID = "dev.crust.sweep.probe.absent";

/**
 * The child: real platform, real plugins from `nativePlugins`, then one `handle()` per case. The
 * harness and case table are written into the temp dir so the child needs no bundler.
 */
export function childScript(casesPath: string): string {
	return `
import { DarwinPlatform } from "./src/platform/darwin/platform.ts";
import { nativePlugins } from "./src/runtime-plugins.ts";
import { corePlugins } from "./src/plugins/core.ts";
import { raiseApp } from "./src/platform/darwin/activation.ts";
import { cls, S } from "./src/platform/darwin/objc.ts";

const SWEEP_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
// A typed { ok: false, code } failure is a refusal when the code names a condition the harness
// cannot satisfy: a capability absent on this platform, or a native half the runtime lacks. These
// are the codes failure-status.ts maps onto 501, plus not-implemented itself. A real answer (a
// command that ran and rejected the caller's arguments) must stay a pass. page-cannot-clear is
// deliberately NOT here: crash-reporter.clear refuses every page caller by design, only the runtime
// may delete evidence; the command still ran and answered, which is what the sweep proves.
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
// AppKit answers AXWindows only for a window on the active Space: with activate "never" the app
// stays inactive, AX lists no windows and elementCount refuses — a real answer, but it would read as
// a gap in the sweep. A human switching apps mid-run has the same effect, so activate "always".
const platform = new DarwinPlatform({ appName: "crust-butter-sweep", activate: "always" });
await platform.start();
platform.createWindow({ label: "main", title: "sweep", url: "about:blank", width: 480, height: 320 });
platform.pump(16);
await Bun.sleep(500); // the webview is built on the platform's own queue

const plugins = await nativePlugins(corePlugins, platform, {
  app: "crust.butter.sweep",
  shell: { allow: ["sh"] },
});
const byName = new Map(plugins.map((p) => [p.name, p]));
const ctx = { emit: () => {} };
const cases = JSON.parse(await Bun.file(${JSON.stringify(casesPath)}).text());
let lastDbHandle;

// The same sends window-create.ts uses: -activateIgnoringOtherApps: is the call that lands for a
// directly-exec'd process, where -activate is silently refused. raiseApp guards it on !isActive.
const appSends = {
  sharedApp: () => S.p0(cls("NSApplication"), "sharedApplication", true),
  isActive: (app) => S.b0(app, "isActive"),
  activateIgnoringOtherApps: (app) => S.vb1(app, "activateIgnoringOtherApps:", 1),
};
const isNoWindows = (answer) =>
  isRefusal(answer) && typeof answer.message === "string" && /AX listed no windows/.test(answer.message);

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
  // The bridge revives a binary argument into a Uint8Array; JSON has none, so a case may name a
  // marker string and the child substitutes it here.
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
  // The bridge attaches the caller's window to every request; a direct call must add it itself.
  const drive = async () => {
    const request = entry.window === undefined ? ctx : { ...ctx, window: entry.window };
    return await handler(revive(entry.args), request);
  };

  let answer;
  try {
    if (entry.command === "accessibility.elementCount") {
      // A focus switch mid-sweep empties AXWindows. Re-raise and retry once before calling it an
      // environment condition, so the parity row still has a real count when the app comes back.
      for (let attempt = 0; attempt < 2; attempt++) {
        raiseApp(appSends);
        await Bun.sleep(250);
        answer = await drive();
        if (!isNoWindows(answer)) break;
      }
    } else {
      answer = await drive();
    }
  } catch (error) {
    // A throw is a run: the command was reached and refused for a reason it named.
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "threw" }));
    continue;
  }
  if (entry.command === "database.open" && answer && answer.ok === true && typeof answer.handle === "string") {
    lastDbHandle = answer.handle;
  }
  if (isNoWindows(answer)) {
    // The app could not be brought forward: no proof of the row, but no capability gap either.
    console.log(JSON.stringify({ command: entry.command, refusal: false, detail: "frontmost-lost", frontmostLost: true, report: answer.message }));
    continue;
  }
  console.log(JSON.stringify({ command: entry.command, refusal: isRefusal(answer), detail: isRefusal(answer) ? JSON.stringify(answer).slice(0, 120) : "ok" }));
}

platform.stopPump();
process.exit(0);
`;
}
