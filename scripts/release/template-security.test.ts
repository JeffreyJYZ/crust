/**
 * Every scaffold must grant the page it ships.
 *
 * Declaring `security.capabilities` turns the bridge deny-by-default, so a template's config is only
 * correct when its grant covers the exact actions its own page calls — a scaffold that refuses its
 * own page on first run is worse than no sample. The page is read, its `invoke` calls extracted, and
 * each one run through the real matcher, so a template that stops calling `greet` or starts calling a
 * plugin fails here instead of at a user's first launch.
 *
 * The config is evaluated with the `import type` line and `satisfies` stripped: both are erased before
 * a config is data, and loading the module for real would pull `crust` into a template test.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileCapabilities } from "../../src/bridge/server/capabilities.ts";
import { validateConfig } from "../../src/config";

const ROOT = join(import.meta.dir, "..", "..");

/** One scaffold: the directory, the flag `crust init` takes, and the files its page lives in. */
const TEMPLATES = [
	{ name: "default", flag: "", page: ["public/app.js", "main.ts"] },
	{ name: "react", flag: "--react", page: ["src/main.tsx", "main.ts"] },
	{ name: "next", flag: "--next", page: ["app/page.tsx", "main.ts"] },
	{ name: "svelte", flag: "--svelte", page: ["src/App.svelte", "main.ts"] },
	{ name: "vue", flag: "--vue", page: ["src/App.vue", "main.ts"] },
] as const;

const read = (dir: string, path: string): Promise<string> => Bun.file(join(dir, path)).text();

/** The config as data: the type import and `satisfies` are erased before a config object exists. */
function configObject(source: string): unknown {
	const body = source
		.replace(/^\s*import[^;]*;\s*$/gm, "")
		.replace("export default", "return")
		.replace(/\s*satisfies\s+CrustConfig/, "");
	return new Function(body)();
}

/**
 * Every action a page calls, in the bridge's own spelling.
 *
 * `invoke("greet", { … })` is the app form: `invoke` is a dispatcher, so the gate checks the command
 * the `name` selects — `app:greet`, not the wire key `app:invoke`. `invoke("fs", "readTextFile")` is
 * the plugin form and travels as `fs:readTextFile` — the two forms `install.ts` documents.
 */
function actionsIn(source: string): string[] {
	const found = new Set<string>();
	for (const match of source.matchAll(/\.invoke\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/g)) {
		const [, first, second] = match;
		if (first === undefined) continue;
		found.add(second === undefined ? `app:${first}` : `${first}:${second}`);
	}
	return [...found];
}

describe("a template grants what its own page calls", () => {
	for (const row of TEMPLATES) {
		test(`templates/${row.name}`, async () => {
			const dir = join(ROOT, "templates", row.name);
			const config = validateConfig(configObject(await read(dir, "crust.config.ts")));

			const capabilities = config.security?.capabilities ?? [];
			expect(capabilities.length).toBeGreaterThan(0);
			// A grant naming a capability that does not exist is a launch failure, so this is the
			// validator's own rule restated: the template must not depend on a typo.
			const declared = new Set(capabilities.map((one) => one.name));
			for (const granted of Object.values(config.security?.grants ?? {})) {
				for (const name of granted) expect(declared.has(name)).toBe(true);
			}

			const calls = (
				await Promise.all(row.page.map((path) => read(dir, path).catch(() => "")))
			).flatMap(actionsIn);
			// A template whose page calls nothing needs no grant; the comment in its config says so.
			if (calls.length === 0) return;

			const compiled = compileCapabilities(config.security);
			expect(compiled.open).toBe(false);
			for (const action of calls)
				expect([action, compiled.allows("main", action)]).toEqual([action, true]);
		});
	}
});

describe("crust init writes a config that validates", () => {
	test("all five scaffolds", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-template-security-"));
		try {
			const { init } = await import("../../src/cli/init.ts");
			for (const row of TEMPLATES) {
				const target = join(workspace, row.name);
				const options: Record<string, unknown> = { dir: target };
				const key = flagKey(row.flag);
				if (key !== undefined) options[key] = true;
				const code = await init(options as never);
				expect([row.name, code]).toEqual([row.name, 0]);
				const written = await Bun.file(join(target, "crust.config.ts")).text();
				// No template token survives: an unsubstituted `{{…}}` would reach the user's config.
				expect(written).not.toContain("{{");
				const config = validateConfig(configObject(written));
				expect(config.security?.grants?.main?.length).toBeGreaterThan(0);
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});

/** `--react` is `options.react`; the default scaffold takes no flag at all. */
function flagKey(flag: string): string | undefined {
	return flag === "" ? undefined : flag.slice(2);
}
