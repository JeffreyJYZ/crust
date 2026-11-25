import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SIDECAR_MANIFEST } from "@/plugins/sidecar";
import { nsisScript, type NsisScriptOptions } from "./nsis";

const OPTIONS: Omit<NsisScriptOptions, "appPath" | "out"> = {
	binaryName: "example.exe",
	id: "land.jyz.example",
	name: "Example",
	version: "0.1.0",
};

describe("nsisScript sidecars", () => {
	test("emits a File /oname= line per sidecar and one for the manifest", () => {
		const appPath = "/dist";
		const script = nsisScript({
			...OPTIONS,
			appPath,
			out: join(appPath, "setup.exe"),
			sidecars: ["bin/tool.sh"],
		});
		expect(script).toContain(`  File /oname=bin\\tool.sh "${join(appPath, "bin", "tool.sh")}"`);
		expect(script).toContain(`  File "${join(appPath, SIDECAR_MANIFEST)}"`);
		// `File /oname` does not create `bin`; without this the sidecar lands nowhere.
		expect(script).toContain('  CreateDirectory "$INSTDIR\\bin"');
		expect(script.indexOf('CreateDirectory "$INSTDIR\\bin"')).toBeLessThan(
			script.indexOf("File /oname=bin\\tool.sh"),
		);
	});

	test("emits one CreateDirectory per distinct nested parent", () => {
		const appPath = "/dist";
		const script = nsisScript({
			...OPTIONS,
			appPath,
			out: join(appPath, "setup.exe"),
			sidecars: ["a/b/tool.sh", "a/b/other.sh", "tools/helper"],
		});
		expect(script.match(/CreateDirectory "\$INSTDIR\\a\\b"/g)).toHaveLength(1);
		expect(script).toContain('  CreateDirectory "$INSTDIR\\tools"');
	});
});
