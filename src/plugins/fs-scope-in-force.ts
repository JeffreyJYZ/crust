/**
 * The scoped instance the runtime configured from `fs.scope`, held for the namespaces that read a
 * file: `preview` today. Its own module so `fs-scope.ts` stays under the line cap, and the record is
 * one-way — only an *enabled* scope is remembered, so an app with no `fs.scope` leaves nothing here
 * for another namespace to inherit.
 */
export interface ScopeCheck {
	check(path: string): Promise<void>;
}

let inForce: ScopeCheck | undefined;

/** Called by `createFsScope` for an enabled scope; the last one built is the one in force. */
export function rememberScopedFsScope(scope: ScopeCheck): void {
	inForce = scope;
}

/** The configured boundary a namespace inherits, or undefined when the app declared none. */
export function scopedFsScope(): ScopeCheck | undefined {
	return inForce;
}
