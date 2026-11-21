/**
 * The symbol names a generated bindings module can export. TypeScript reserves a short list of words,
 * and an extension's C symbol may be named after any of them, so the generator refuses the name with a
 * message the author can act on rather than emitting a module that cannot parse.
 */

const RESERVED = new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"eval",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"package",
	"private",
	"protected",
	"public",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
]);

/**
 * Identifiers the generated bindings module declares at its own top level. A C symbol named after one
 * of them emits a duplicate `const`/`function` at module scope, so the module cannot parse and the
 * command is silently absent. Reserved here rather than escaped: the C name is the wire contract and
 * the generated export name must stay the symbol's name to keep `ffi.symbols.<name>` working.
 */
const GENERATED_LOCALS = new Set([
	"ffi",
	"DYLIB",
	"open",
	"reload",
	"join",
	"dlopen",
	"FFIType",
	"ABI",
]);

/** Legal as an identifier but forbidden as a declaration in a module's strict mode. */
const STRICT_ILLEGAL = new Set(["arguments"]);

/** Throws when `name` cannot be an `export const` in the generated module. */
export function checkName(name: string): void {
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || RESERVED.has(name)) {
		throw new Error(`symbol ${JSON.stringify(name)} is not a usable TypeScript export name`);
	}
	if (GENERATED_LOCALS.has(name)) {
		throw new Error(
			`symbol ${JSON.stringify(name)} collides with a name the generated bindings module declares ` +
				`(ffi, open, DYLIB, reload, …) — rename the C symbol or the generated export`,
		);
	}
	if (STRICT_ILLEGAL.has(name)) {
		throw new Error(
			`symbol ${JSON.stringify(name)} cannot be declared in a module's strict mode`,
		);
	}
}
