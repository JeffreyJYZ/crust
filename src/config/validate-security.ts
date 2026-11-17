/**
 * `security.capabilities` and `security.grants`, validated by name so a typo is a launch failure.
 *
 * The action spelling is `plugin:command` — `shell:spawn`, `fs:read*`, `dialog:*`. The dotted
 * `shell.spawn` is refused rather than accepted as a second spelling: one action with two spellings
 * means a grant that looks right and covers nothing, or covers more than the author meant.
 */

import type { Validator } from "./validator.ts";

export const SECURITY_KEYS = ["csp", "capabilities", "grants"] as const;

/** One action pattern: a plugin name, a colon, and a command pattern with `*` as the metacharacter. */
const ACTION = /^[A-Za-z0-9_-]+:[A-Za-z0-9_.*-]+$/;

function validateCapabilities(v: Validator, value: unknown): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		v.fail("security.capabilities", "an array of capabilities", value);
		return;
	}
	const seen = new Set<string>();
	value.forEach((item, index) => {
		const path = `security.capabilities[${index}]`;
		const capability = v.object(path, item);
		if (!capability) return;
		v.only(capability, path, ["name", "actions"] as const);
		const name = v.string(capability, "name", path, true);
		if (name !== undefined) {
			if (seen.has(name)) {
				// A duplicate name makes `grants` ambiguous: which of the two did the author mean?
				v.fail(`${path}.name`, "a name no other capability uses", name);
			}
			seen.add(name);
		}

		const actions = capability.actions;
		if (actions === undefined) {
			v.fail(`${path}.actions`, "a non-empty array of action patterns", actions);
			return;
		}
		if (!Array.isArray(actions) || actions.length === 0) {
			v.fail(`${path}.actions`, "a non-empty array of action patterns", actions);
			return;
		}
		actions.forEach((action, at) => {
			const actionPath = `${path}.actions[${at}]`;
			if (typeof action !== "string" || action.trim() === "") {
				v.fail(actionPath, "a non-empty string", action);
				return;
			}
			if (!ACTION.test(action)) {
				v.fail(
					actionPath,
					'an action like "shell:spawn", "fs:read*" or "dialog:*"',
					action,
				);
			}
		});
	});
}

function validateGrants(v: Validator, value: unknown, known: ReadonlySet<string>): void {
	if (value === undefined) return;
	const grants = v.object("security.grants", value);
	if (!grants) return;
	for (const [label, names] of Object.entries(grants)) {
		const path = `security.grants.${label}`;
		if (label.trim() === "") {
			v.fail("security.grants", "window labels as keys", label);
			continue;
		}
		const list = v.stringArray(grants, label, "security.grants");
		if (list === undefined) continue;
		list.forEach((name, index) => {
			if (known.has(name)) return;
			v.fail(
				`${path}[${index}]`,
				"the name of a capability declared in security.capabilities",
				name,
			);
		});
	}
}

export function validateSecurity(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const security = v.object("security", value);
	if (!security) return;
	v.only(security, "security", SECURITY_KEYS);
	v.string(security, "csp", "security", false);

	validateCapabilities(v, security.capabilities);

	const known = new Set<string>();
	for (const item of Array.isArray(security.capabilities) ? security.capabilities : []) {
		const name = (item as { name?: unknown } | null)?.name;
		if (typeof name === "string") known.add(name);
	}
	validateGrants(v, security.grants, known);
}
