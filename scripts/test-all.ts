#!/usr/bin/env bun
/**
 * Run every shipped test file. Positional args pass through to `bun test` so the
 * junit reporter used by `test:no-skips` still works.
 */
import { join } from "node:path";
import { discoverTests } from "./test-files.ts";

const files = await discoverTests();
const args = ["test", ...process.argv.slice(2), ...files];
const child = Bun.spawn(["bun", ...args], {
	cwd: join(import.meta.dir, ".."),
	stdout: "inherit",
	stderr: "inherit",
	stdin: "inherit",
});
process.exit(await child.exited);
