/**
 * The binary under test, the tiny page it serves, and the two environments the
 * interpreter branches differ by.
 */
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const BIN = resolve(REPO_ROOT, process.env.CRUST_BIN ?? "dist/crust");

/** The window, the shim compile and WebKit's web process, generously bounded. */
export const DEV_TIMEOUT_MS = 45_000;

/** The line the page's own `invoke` produces, printed by the framework's `info` command. */
export const INFO = /info\s+app answered the page/;
/** The payload proving `echo` returned what the page sent. */
export const ECHO = /echo\s+\{"from":"page","ok":true\}/;
/** The scaffold's page calls `greet`, and `main.ts` logs the answer. */
export const GREET = /greet\s+hello crust \(page call answered\)/;
/** The scaffold's `ready` handler, so the project path proves a window too. */
export const WINDOW = /window\s+open/;

export const SINGLE_PAGE = `// No default export: this page owns the DOM and proves the round trip itself.
const reply = await window.crust.invoke("info", { from: "page" });
document.title = \`info:\${reply.app}:\${reply.single}\`;
document.body.textContent = \`reply \${JSON.stringify(reply)}\`;
await window.crust.invoke("echo", { from: "page", ok: true });
`;

/** The PATH a machine that installed crust alone has. */
export const NO_BUN_PATH = "/usr/bin:/bin";

/**
 * A minimal environment: enough for WebKit and for `tmpdir()` to agree with this
 * process, and a PATH with no Bun in it. `env -i` is used rather than a spawn option so
 * the proof does not depend on this harness's own environment leaking anything in.
 */
export function bare(path: string): string[] {
	return [
		"/usr/bin/env",
		"-i",
		`PATH=${path}`,
		`HOME=${process.env.HOME ?? ""}`,
		`TMPDIR=${tmpdir()}`,
		BIN,
	];
}
