/**
 * The `extensions` section of `crust doctor`. A project with no `native/`
 * directory gets one line and no failures: there is nothing to build, so there
 * is nothing to report as broken.
 */

import { resolve } from "node:path";
import { type ExtensionSeams, describeExtensions, doctorExtensions } from "@/packaging/extensions";
import { exists } from "../util.ts";

export interface ExtensionsSection {
	/** The block, one line per toolchain and one per source file. */
	text: string;
	/** Source files whose toolchain is missing; zero when there is no `native/`. */
	failures: number;
}

export async function extensionsSection(
	dir: string,
	seams: ExtensionSeams = {},
): Promise<ExtensionsSection> {
	const native = resolve(dir, "native");
	if (!(await exists(native, "dir"))) {
		return { text: `extensions  no native/ directory in ${resolve(dir)}`, failures: 0 };
	}
	const report = await doctorExtensions({ dir: native, ...seams });
	return {
		text: describeExtensions(report),
		failures: report.files.filter((file) => !file.ok).length,
	};
}
