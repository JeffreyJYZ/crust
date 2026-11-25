/**
 * A malformed percent escape is a bad path (400), not a handler fault (500). The asset route is
 * unauthenticated, so this is also a shape any request can reach.
 */
import { expect, test } from "bun:test";
import { isCrustError } from "../errors.ts";
import { assetBody } from "./assets.ts";

const options = {
	handlers: [],
	assets: { "/hello.txt": "hello" },
};

test("a broken percent escape refuses with bad-request", async () => {
	for (const path of ["/%zz.js", "/%E0%A4%A", "/%"]) {
		const error = await assetBody(path, options).catch((cause: unknown) => cause);
		expect(isCrustError(error)).toBe(true);
		expect(error).toMatchObject({ code: "bad-request", status: 400 });
	}
});

test("a valid escaped asset path still resolves", async () => {
	expect(await assetBody("/hello%2Etxt", options)).toBe("hello");
});
