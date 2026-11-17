/**
 * Capabilities: which command a page in a given window may call.
 *
 * The model is the one Tauri and Butter ship: a capability names a set of command patterns, a window
 * label holds capabilities, and the bridge refuses anything the label does not hold. Three rules,
 * and the first is the compatibility guarantee:
 *
 * 1. **No `security.capabilities` (or an empty list) allows everything.** Every app written before
 *    this existed keeps working with no config change.
 * 2. **Present and non-empty means deny by default.** A label with no entry in `grants` holds
 *    nothing, so it may call nothing.
 * 3. **A grant is per window label** — the only thing the bridge knows about a request — so a page
 *    can no longer *become* another window's authority.
 *
 * Matching is `patternMatches` from the network plugin, with case folding off: a command name is
 * case-sensitive, and `*` stays the one metacharacter so no regular expression reaches the main
 * thread. The action spelling is `plugin:command` (`shell:spawn`); the dotted `shell.spawn` is
 * refused by the validator rather than accepted as a second spelling, because two spellings for one
 * action is how a grant silently covers something the author did not mean.
 *
 * This is authorisation, not a sandbox: a label that holds `fs:*` may read and write every file the
 * plugin itself can reach.
 */

import type { CapabilityConfig, SecurityConfig } from "../../config/types.ts";
import { patternMatches } from "../../plugins/network-match.ts";

/** The action a request names: `plugin:command`. */
export function actionOf(plugin: string, command: string): string {
	return `${plugin}:${command}`;
}

/** What the invoke path asks: may this label call this action, and if not, which capability would have allowed it. */
export interface CompiledCapabilities {
	/** True when no capability list was configured, so every command is allowed. */
	readonly open: boolean;
	allows(label: string | undefined, action: string): boolean;
	/** The first configured capability whose actions cover `action`, for the refusal to name it. */
	covering(action: string): string | undefined;
}

/** The table every bridge starts with: no config, no restriction. */
const OPEN: CompiledCapabilities = {
	open: true,
	allows: () => true,
	covering: () => undefined,
};

/**
 * The refusal an author reads at 2am: which command, which window, and the capability that would
 * have allowed it. Never a bare "denied" — the person reading this is the app's own author.
 */
export function forbiddenMessage(
	action: string,
	label: string | undefined,
	capabilities: CompiledCapabilities,
): string {
	const who = label === undefined ? "a request with no window label" : `window "${label}"`;
	const why = capabilities.covering(action);
	const hint =
		why === undefined
			? "no configured capability lists this action"
			: `capability "${why}" would allow it — add it to that label's grants`;
	return `${action} is not granted to ${who}: ${hint}`;
}

function matchesAny(patterns: readonly string[], action: string): boolean {
	return patterns.some((pattern) => patternMatches(pattern, action, { caseInsensitive: false }));
}

/**
 * Resolve the config once, at bridge start, into the per-label pattern lists the invoke path reads
 * on every call. `grants` names capabilities that may not exist; the validator refuses those by
 * name, and a name absent here is simply dropped rather than throwing at request time.
 */
export function compileCapabilities(
	security: Pick<SecurityConfig, "capabilities" | "grants"> | undefined,
): CompiledCapabilities {
	const capabilities = security?.capabilities ?? [];
	if (capabilities.length === 0) return OPEN;

	const byName = new Map<string, readonly string[]>();
	for (const capability of capabilities as readonly CapabilityConfig[]) {
		byName.set(capability.name, capability.actions);
	}

	const perLabel = new Map<string, readonly string[]>();
	for (const [label, names] of Object.entries(security?.grants ?? {})) {
		const patterns: string[] = [];
		for (const name of names) patterns.push(...(byName.get(name) ?? []));
		perLabel.set(label, patterns);
	}

	return {
		open: false,
		allows(label, action) {
			if (label === undefined) return false;
			const patterns = perLabel.get(label);
			return patterns !== undefined && matchesAny(patterns, action);
		},
		covering(action) {
			for (const [name, patterns] of byName) {
				if (matchesAny(patterns, action)) return name;
			}
			return undefined;
		},
	};
}
