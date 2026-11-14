/**
 * The `dev.url` decisions: which port a URL names, and what a port that is
 * taken means for a `strictPort` dev server.
 */

import { describe, expect, test } from "bun:test";
import { classifyDevPort, devUrlTarget } from "../doctor.ts";

describe("devUrlTarget", () => {
	test("reads the port a loopback url names, and the protocol default", () => {
		expect(devUrlTarget("http://localhost:5173")).toEqual({
			hostname: "localhost",
			port: 5173,
		});
		expect(devUrlTarget("http://127.0.0.1:3000/")).toEqual({
			hostname: "127.0.0.1",
			port: 3000,
		});
		expect(devUrlTarget("https://localhost")).toEqual({ hostname: "localhost", port: 443 });
	});

	test("tells a remote host and an unreadable string apart", () => {
		expect(devUrlTarget("http://example.com:5173")).toBe("remote");
		expect(devUrlTarget("nonsense")).toBe("unreadable");
	});
});

describe("classifyDevPort", () => {
	const base = { url: "http://localhost:5173", port: 5173 };

	test("a free port is ok and names it", () => {
		const check = classifyDevPort({ ...base, listening: false, answered: false });

		expect(check.name).toBe("dev port");
		expect(check.status).toBe("ok");
		expect(check.detail).toContain("port 5173 is free");
		expect(check.detail).toContain(base.url);
	});

	test("a port held by the dev server already answering is a note, not a fail", () => {
		const check = classifyDevPort({
			...base,
			listening: true,
			answered: true,
			holder: 4242,
		});

		expect(check.status).toBe("note");
		expect(check.detail).toContain("held by pid 4242");
		expect(check.detail).toContain("already answers");
		expect(check.detail).toContain("change dev.url");
	});

	test("a holder that answers nothing on that url is fatal, naming the next step", () => {
		const check = classifyDevPort({ ...base, listening: true, answered: false, holder: 77 });

		expect(check.status).toBe("fail");
		expect(check.detail).toContain("pid 77");
		expect(check.detail).toContain("does not answer");
		expect(check.detail).toContain("strictPort");
		expect(check.detail).toContain("free the port or change dev.url");
	});

	test("a pid lsof cannot read still names the port and the holder", () => {
		const check = classifyDevPort({ ...base, listening: true, answered: true });

		expect(check.status).toBe("note");
		expect(check.detail).toContain("lsof cannot read");
	});

	test("an answering url with nothing on the port is a proxy or a remote host", () => {
		const check = classifyDevPort({ ...base, listening: false, answered: true });

		expect(check.status).toBe("note");
		expect(check.detail).toContain("nothing is listening");
	});
});
