/**
 * A bridge that cannot bind any port must name the ports it tried and the two
 * next actions: find what holds the port, or shift the preferred port via app.id.
 */

import { describe, expect, test } from "bun:test";

import { bridgeBindFailure } from "./runtime-host.ts";

describe("bridge bind failure message", () => {
	test("names the preferred port, what holds it and how to change it", () => {
		const message = bridgeBindFailure(45678, new Error("EADDRINUSE")).message;
		expect(message).toContain("45678");
		expect(message).toContain("45697");
		expect(message).toContain("lsof -nP -iTCP:45678");
		expect(message).toContain("app.id in crust.config.ts");
		expect(message).toContain("another one");
		expect(message).toContain("EADDRINUSE");
	});

	test("names the port and next actions even with no underlying cause", () => {
		const message = bridgeBindFailure(46001).message;
		expect(message).toContain("46001");
		expect(message).toContain("lsof -nP -iTCP:46001");
		expect(message).toContain("app.id in crust.config.ts");
	});
});
