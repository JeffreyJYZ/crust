/**
 * Text imports. The C shim travels inside the binary as a string so that
 * `cc()` can compile it at launch even when `import.meta.dir` is `/$bunfs/root`.
 */
declare module "*.c" {
	const source: string;
	export default source;
}
