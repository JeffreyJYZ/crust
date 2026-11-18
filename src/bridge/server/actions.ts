/**
 * Action resolution for the capability gate.
 *
 * Most wire commands map to one action, `plugin:command`. The `app` namespace's `invoke` is a
 * dispatcher: its `name` argument selects an `app.command` registered by main.ts, so the action the
 * gate must check is `app:<name>`, not the wire key `app:invoke`. Without this, a grant aimed at one
 * app command either covers nothing (`notes:*`) or covers every app command present and future
 * (`app:invoke`) — the defect `docs/reviews/next-wave/api-design.md` §1 names.
 *
 * The wire action stays a second candidate, so a capability that deliberately grants `app:invoke`
 * still reaches every app command. The scaffolds grant exactly that, and existing apps must not
 * break. Narrow grants now work: `app:notes.save` covers only that command. Once a label holds only
 * the narrow grant, naming a different command is a `forbidden` that names `app:<that command>`.
 */

import { APP_NAMESPACE } from "../../app-types.ts";
import { actionOf } from "./capabilities.ts";

/** `plugin.command` -> the argument field that names the finer-grained action. */
const DISPATCH_FIELDS: ReadonlyMap<string, string> = new Map([[`${APP_NAMESPACE}.invoke`, "name"]]);

function dispatchedName(plugin: string, command: string, args: unknown): string | undefined {
	const field = DISPATCH_FIELDS.get(`${plugin}.${command}`);
	if (field === undefined || typeof args !== "object" || args === null) return undefined;
	const value = (args as Record<string, unknown>)[field];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The finest action a request names: `app:notes.save` for a dispatched app command. */
export function effectiveAction(plugin: string, command: string, args: unknown): string {
	const name = dispatchedName(plugin, command, args);
	return name === undefined ? actionOf(plugin, command) : actionOf(plugin, name);
}

/**
 * Every action that may authorise the request, finest first. The refusal names the first one, so a
 * page that tries `notes.delete` under a `notes.save` grant sees `app:notes.delete` in the error.
 */
export function candidateActions(plugin: string, command: string, args: unknown): string[] {
	const wire = actionOf(plugin, command);
	const fine = effectiveAction(plugin, command, args);
	return fine === wire ? [wire] : [fine, wire];
}
