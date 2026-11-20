/** The row shape and its two constructors, shared by the contract tables without a cycle. */

export const HINT = 'run "crust --help" for usage';

export interface Row {
	name: string;
	args: string[];
	code: number;
	out?: string[];
	err?: string[];
	outNot?: string[];
	/** Pin that a stream is completely empty. */
	outEmpty?: boolean;
	errEmpty?: boolean;
	/** Replace the `<DIR>` token in args with a fresh empty temp directory. */
	freshDir?: boolean;
	/** Environment overrides, so credential refusals do not depend on this machine. */
	env?: Record<string, string>;
}

/** A success row: help or version on stdout, stderr empty. */
export function ok(name: string, args: string[], out: string[], outNot: string[] = []): Row {
	return { name, args, code: 0, out, outNot, errEmpty: true };
}

/** A rejection row: a message on stderr, stdout empty. */
export function bad(name: string, args: string[], err: string[], extra: Partial<Row> = {}): Row {
	return { name, args, code: 1, err, outEmpty: true, ...extra };
}
