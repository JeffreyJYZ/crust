/**
 * The `bun:ffi` type tables a generated bindings module is built from. One entry per type keeps the
 * three projections (declaration, parameter, return) in step, so a type added here cannot reach one and
 * miss another.
 */

export type FfiType = "ptr" | "i32" | "i64" | "u32" | "u64" | "f64" | "cstring";
export type FfiReturn = FfiType | "void";

export interface SymbolSpec {
	/** The C symbol name, also the name of the generated export. */
	name: string;
	args: FfiType[];
	returns: FfiReturn;
}

/** The declaration handed to `dlopen`. */
export const FFI: Record<FfiReturn, string> = {
	ptr: "FFIType.ptr",
	i32: "FFIType.i32",
	i64: "FFIType.i64",
	u32: "FFIType.u32",
	u64: "FFIType.u64",
	f64: "FFIType.f64",
	cstring: "FFIType.cstring",
	void: "FFIType.void",
};

/** What the call answers. `i64`/`u64` are `bigint` because that is what `bun:ffi` returns for them. */
export const RETURNS: Record<FfiReturn, string> = {
	ptr: "number",
	i32: "number",
	i64: "bigint",
	u32: "number",
	u64: "bigint",
	f64: "number",
	cstring: "string | null",
	void: "void",
};

/** Argument position: a cstring argument takes the JS string bun converts for you. */
export const ARGS: Record<FfiType, string> = {
	ptr: "number",
	i32: "number",
	i64: "bigint",
	u32: "number",
	u64: "bigint",
	f64: "number",
	cstring: "string",
};
