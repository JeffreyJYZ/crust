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

/** Throws when `name` cannot be an `export const` in the generated module. */
export function checkName(name: string): void {
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || RESERVED.has(name)) {
		throw new Error(`symbol ${JSON.stringify(name)} is not a usable TypeScript export name`);
	}
}
