/**
 * The default-export shape test for a single file. Detection runs before the bundle, so it cannot
 * read the bundle's output — but `Bun.Transpiler.scan` is the same parser that bundling uses. An
 * earlier character scanner missed regex literals: a quote in `/["']/` opened a string and `//` in
 * `/https?:\/\//` opened a comment, so a real `export default` vanished and the page opened blank.
 * The parser knows the difference, and also keeps type-only exports and examples in strings out.
 */

const TRANSPILER = new Bun.Transpiler({ loader: "tsx" });

/** Whether the source has a runtime default export, named or `export { x as default }`. */
export function hasDefaultExport(source: string): boolean {
	return TRANSPILER.scan(source).exports.includes("default");
}
