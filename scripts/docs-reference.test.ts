/**
 * Regression guard for the reference pages fixed in the fix wave.
 *
 * Each assertion below maps to a written defect: a command name, count or section
 * that had drifted from the source. They read the MDX files and the source of
 * truth, so a stale doc fails here instead of being re-found by the next hunter.
 */
import { describe, expect, it } from "bun:test";

import { BUILD_KEYS } from "../src/config/validate-build.ts";
import { corePlugins } from "../src/plugins/core.ts";
import { WINDOW_COMMANDS } from "../src/plugins/window-types.ts";

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
		expect(parity).toContain("fs.readTextFile/writeTextFile/readBinary/writeBinary/list/stat/remove/rename/mkdir");
		expect(parity).not.toContain("dialog.open,");
		expect(parity).not.toContain("dialog.save`");
		expect(parity).not.toContain("fs.read/write");
	});
});

describe("config reference page", () => {
	it("is the full table: one section per accepted root key", () => {
		expect(roots.length).toBe(10);
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
