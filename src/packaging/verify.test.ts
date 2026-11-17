import { describe, expect, test } from "bun:test";
import { verifyCommand } from "./verify";

const APP = "/tmp/dist/Crust.app";

describe("verifyCommand", () => {
	test("runs the strict form the CLI claims passed", () => {
		// `crust sign` prints "codesign --verify --strict passed"; a check without
		// --strict would let strict-only issues through while claiming otherwise.
		const argv = verifyCommand(APP);
		expect(argv).toEqual(["codesign", "--verify", "--strict", "--verbose=4", APP]);
		expect(argv).toContain("--strict");
	});
});
