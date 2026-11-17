import { describe, expect, test } from "bun:test";
import { ConfigError, validateConfig } from "@/config";

const base = {
	app: { id: "dev.crust.sidecar", name: "Sidecar", version: "0.0.0" },
	windows: [{ label: "main" }],
};

function withSidecars(sidecars: unknown): unknown {
	return { ...base, build: { sidecars } };
}

function issuePath(sidecars: unknown): string | undefined {
	try {
		validateConfig(withSidecars(sidecars));
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		return (error as ConfigError).issues[0]?.path;
	}
}

describe("build.sidecars validation", () => {
	test("a relative path inside the project is accepted and carried through", () => {
		const config = validateConfig(withSidecars(["bin/ffmpeg", "tools/yt-dlp"]));
		expect(config.build?.sidecars).toEqual(["bin/ffmpeg", "tools/yt-dlp"]);
	});

	test("an absolute path is a config error naming the entry", () => {
		expect(issuePath(["/usr/bin/ffmpeg"])).toBe("build.sidecars[0]");
	});

	test("a Windows absolute path is refused", () => {
		expect(issuePath(["C:\\tools\\ffmpeg.exe"])).toBe("build.sidecars[0]");
	});

	test("a path that escapes the project with .. is refused", () => {
		expect(issuePath(["../outside"])).toBe("build.sidecars[0]");
	});

	test("a non-array or non-string entry is refused", () => {
		expect(issuePath([7])).toBe("build.sidecars");
		expect(issuePath("ffmpeg")).toBe("build.sidecars");
	});
});
