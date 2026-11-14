/**
 * The scratch project this proof builds: one symlinked framework, two windows,
 * a driver page and a spare document.
 */
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { APP_NAME, BINARY_NAME, CONFIG_SOURCE, MAIN_SOURCE } from "./fixture/config.ts";
import { PAGE_SOURCE } from "./fixture/page.ts";
import { IDLE_SOURCE, INDEX_SOURCE } from "./fixture/sources.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const CLI = join(REPO_ROOT, "src/cli/index.ts");

/**
 * The example imports `crust`, which resolves through this package's own exports
 * map inside the checkout. A scratch copy has no install, so one symlink to the
 * checkout stands in for it — and it is also what `projectCrustRoot` realpaths,
 * so the compiled binary carries exactly one copy of the framework.
 * (`scripts/package/` uses the same trick for the same reason.)
 */
const FALLBACK_DEPENDENCY = REPO_ROOT;

/** Write the project and its page, then return the binary path the probe runs. */
export async function sandbox(scratch: string): Promise<string> {
	await mkdir(join(scratch, "node_modules"), { recursive: true });
	await symlink(FALLBACK_DEPENDENCY, join(scratch, "node_modules", "crust"), "dir");
	await mkdir(join(scratch, "public"), { recursive: true });
	await mkdir(join(scratch, "public", "spare"), { recursive: true });
	await writeFile(join(scratch, "crust.config.ts"), CONFIG_SOURCE, "utf8");
	await writeFile(join(scratch, "main.ts"), MAIN_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "index.html"), INDEX_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "app.js"), PAGE_SOURCE, "utf8");
	await writeFile(join(scratch, "public", "spare", "idle.html"), IDLE_SOURCE, "utf8");
	return join(scratch, "dist", `${APP_NAME}.app`, "Contents", "MacOS", BINARY_NAME);
}
