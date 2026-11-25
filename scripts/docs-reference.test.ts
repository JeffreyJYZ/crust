/**
 * Regression guard for the reference pages fixed in the fix wave.
 *
 * Each assertion below maps to a written defect: a command name, count or section
 * that had drifted from the source. They read the MDX files and the source of
 * truth, so a stale doc fails here instead of being re-found by the next hunter.
 *
 * The namespace check below closes hole 3 of docs/plan/docs-coverage/01-gaps.md. The hole it
 * leaves open: nothing yet compares a documented arg shape to the implementation.
 */
import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

import { BUILD_KEYS } from "../src/config/validate-build.ts";
import { corePlugins } from "../src/plugins/core.ts";
import { WINDOW_COMMANDS } from "../src/plugins/window-types.ts";
import { type DocPage, uncoveredNamespaces } from "./docs-coverage.ts";
import { registry } from "./skill/registry.ts";

const parity = await Bun.file("site/app/docs/reference/parity/page.mdx").text();
const config = await Bun.file("site/app/docs/reference/config/page.mdx").text();
const schema = await Bun.file("src/config/schema.ts").text();

/** The accepted root keys, read from the validator so this list cannot drift. */
const rootBlock = schema.slice(
	schema.indexOf("const ROOT_KEYS"),
	schema.indexOf("] as const;", schema.indexOf("const ROOT_KEYS")),
);
const roots = [...rootBlock.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);

describe("parity reference page", () => {
	it("uses the registered notification command, not send", () => {
		expect(parity).toContain("notification.notify");
		expect(parity).not.toContain("notification.send");
	});

	it("counts every window command", () => {
		expect(parity).toContain(`${WINDOW_COMMANDS.length} commands`);
		expect(parity).not.toContain("25 commands");
	});

	it("names App.run, not a nonexistent App.start", () => {
		expect(parity).toContain("app.run()");
		expect(parity).not.toContain("app.start()");
	});

	it("uses the exact fs and dialog command names", () => {
		expect(parity).toContain("dialog.openPanel/savePanel/cancel");
		expect(parity).toContain(
			"fs.readTextFile/writeTextFile/readBinary/writeBinary/list/stat/remove/rename/mkdir",
		);
		expect(parity).not.toContain("dialog.open,");
		expect(parity).not.toContain("dialog.save`");
		expect(parity).not.toContain("fs.read/write");
	});
});

describe("config reference page", () => {
	it("is the full table: one section per accepted root key", () => {
		// The count follows `ROOT_KEYS` in `src/config/schema.ts`; a literal here went stale every
		// time a section was added (`logging` made it eleven), so only uniqueness is asserted and the
		// loop below proves every key the validator reads has its own section.
		expect(roots.length).toBeGreaterThan(0);
		expect(new Set(roots).size).toBe(roots.length);
		for (const key of roots) {
			expect(config, `missing section for ${key}`).toContain(`## \`${key}\``);
		}
	});

	it("documents every accepted build key", () => {
		const buildTable = config.slice(
			config.indexOf("| `beforeBuildCommand`"),
			config.indexOf("## `plugins`"),
		);
		for (const key of BUILD_KEYS) {
			expect(buildTable, `missing build key ${key}`).toMatch(
				new RegExp(`\\|\\s*\`${key}\`\\s*\\|`),
			);
		}
	});

	it("describes the real plugins default and error text", () => {
		expect(config).not.toContain("all five");
		expect(config).not.toContain("v1 ships fs, dialog, notification, tray, window");
		expect(config).toContain("all built-ins");
		// The core set named in the docs must match the registered core plugins.
		for (const plugin of corePlugins) {
			expect(config, `core plugin ${plugin.name} missing from default description`).toContain(
				`\`${plugin.name}\``,
			);
		}
	});
});

const pagePaths = [
	...new Glob("site/app/docs/reference/api*/page.mdx").scanSync("."),
	...new Glob("site/app/docs/guides/*/page.mdx").scanSync("."),
].sort();
const pages: DocPage[] = await Promise.all(
	pagePaths.map(async (path) => ({ path, text: await Bun.file(path).text() })),
);

describe("namespace coverage", () => {
	it("gives every registered namespace a reference heading or a guide", async () => {
		const names = (await registry()).map((namespace) => namespace.name);
		const uncovered = uncoveredNamespaces(names, pages);
		expect(
			uncovered,
			`no reference/*api heading and no guide names: ${uncovered.join(", ")}`,
		).toEqual([]);
	});

	it("classifies by name, so an omitted namespace is reported", () => {
		const fixture: DocPage[] = [
			{ path: "site/app/docs/reference/api-window/page.mdx", text: "## `window`\n## `tray`" },
			{ path: "site/app/docs/guides/screen/page.mdx", text: "# Screen" },
			{ path: "site/app/docs/guides/keychain/page.mdx", text: "# Secure storage" },
		];
		expect(uncoveredNamespaces(["window", "tray", "screen", "keychain"], fixture)).toEqual([]);
		// A hyphenated heading covers only its own name.
		const hyphenated: DocPage[] = [
			{ path: "site/app/docs/reference/api-window/page.mdx", text: "## `window-state`" },
		];
		expect(uncoveredNamespaces(["window"], hyphenated)).toEqual(["window"]);
		// A name with no page comes back by name, so the next gap reports itself.
		expect(uncoveredNamespaces(["window", "store"], fixture)).toEqual(["store"]);
		expect(
			uncoveredNamespaces(["window", "tray", "screen", "keychain", "database"], fixture),
		).toEqual(["database"]);
	});
});

/** hunt-22/16: claims that contradicted the validator, the registry or the running code. */
describe("reference claims match the code", () => {
	const read = (path: string) => Bun.file(`site/app/docs/${path}`).text();

	it("the CLI reference counts the five cac commands plus perf", async () => {
		const cli = await read("reference/cli/page.mdx");
		expect(cli).toContain("six commands");
		expect(cli).not.toContain("five commands");
		expect(cli).toContain("crust perf");
	});

	it("the API reference lists every registered command in the four truncated tables", async () => {
		const desktop = await read("reference/api-desktop/page.mdx");
		for (const command of ["announce", "title", "focus"])
			expect(desktop, `accessibility.${command}`).toContain(`\`${command}\``);
		const web = await read("reference/api-web/page.mdx");
		for (const command of ["status", "onChange", "report", "configure"])
			expect(web, `network/crash.${command}`).toContain(`\`${command}\``);
		expect(await read("reference/api-app/page.mdx")).toContain("`load`");
	});

	it("the CSP pages resolve the effective directive, not just script-src", async () => {
		expect(config).not.toContain("a policy with no `script-src` is fine");
		expect(config).toContain("`script-src-elem`, then `script-src`, then **`default-src`**");
		expect(await read("limits/page.mdx")).toContain(
			"`script-src-elem`, then `script-src`, then `default-src`",
		);
	});

	it("logging.console mirrors warn and error in a built app, every level in dev", async () => {
		const guide = await read("guides/logging/page.mdx");
		expect(guide).not.toContain("mirrors every written record");
		expect(guide).toContain("mirrors `warn` and `error`");
		expect(config).toContain("only `warn` and `error` are mirrored");
	});

	it("the Linux network refusal names the GIO monitor the code names", async () => {
		const guide = await read("guides/network/page.mdx");
		expect(guide).not.toContain("NetworkChangeNotifier from Gdk");
		expect(guide).toContain(
			"GNetworkMonitor in GIO (libgio-2.0.so.0, loaded through libgtk-3)",
		);
	});

	it("the crash record shape includes type, message and stack", async () => {
		const web = await read("reference/api-web/page.mdx");
		expect(web).toContain(
			"`{ type, signal, code, address, at, handler, exitCode, message?, stack? }`",
		);
		expect(web).not.toContain(
			"A crash record is `{ signal, code, address, at, handler, exitCode }`",
		);
	});

	it("the network body bound refuses 262144 bytes, not only more", async () => {
		const web = await read("reference/api-web/page.mdx");
		expect(web).toContain("a body of 262144 bytes or more");
		expect(web).toContain("262143 bytes is the most the native buffer can deliver");
	});
});
