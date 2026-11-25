/** The dev readiness message must point at output that actually exists. */
import { expect, test } from "bun:test";

import { devTimeoutMessage } from "./timeout.ts";

test("a configured beforeDevCommand points at its output", () => {
	expect(devTimeoutMessage("http://127.0.0.1:5173", "bun run dev")).toContain(
		"Check the beforeDevCommand output above",
	);
});

test("an external server with no beforeDevCommand names the URL, not phantom output", () => {
	const message = devTimeoutMessage("http://127.0.0.1:5173");
	expect(message).not.toContain("beforeDevCommand output");
	expect(message).toContain("No beforeDevCommand is configured");
	expect(message).toContain("http://127.0.0.1:5173");
});
