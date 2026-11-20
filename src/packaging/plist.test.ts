/**
 * `NSMicrophoneUsageDescription` is the half of capture that TCC checks first: a request from a
 * bundle without it terminates the process instead of prompting. The key is written only when
 * `security.microphone` is set, and its sentence is escaped like every other plist value.
 */

import { describe, expect, test } from "bun:test";

import { infoPlist } from "./plist";

const base = {
	executableName: "crust-app",
	name: "Caps",
	id: "dev.crust.caps",
	version: "0.0.0",
	minimumSystemVersion: "13.0",
	hasIcon: false,
};

describe("Info.plist microphone purpose", () => {
	test("omits the key when the app captures nothing", () => {
		expect(infoPlist(base)).not.toContain("NSMicrophoneUsageDescription");
	});

	test("writes the configured sentence verbatim", () => {
		const sentence = "Caps records voice memos you choose to transcribe.";
		const plist = infoPlist({ ...base, microphone: sentence });
		expect(plist).toContain("<key>NSMicrophoneUsageDescription</key>");
		expect(plist).toContain(`<string>${sentence}</string>`);
	});

	test("escapes plist metacharacters in the sentence", () => {
		const plist = infoPlist({ ...base, microphone: "Records A & B, then <stops>." });
		expect(plist).toContain("<string>Records A &amp; B, then &lt;stops&gt;.</string>");
	});

	test("stays one dict with the key inside it", () => {
		const plist = infoPlist({ ...base, microphone: "Records memos." });
		expect(plist.match(/<dict>/g)?.length).toBe(2); // the root dict and NSAppTransportSecurity
		expect(plist.endsWith("</plist>\n")).toBe(true);
	});
});
