/** Find-in-page against the stub runtime: a search balances its NSString and WKFindConfiguration. */

import { describe, expect, test } from "bun:test";

import { probe } from "./ownership-harness";

const main = `
int test_find_release(void) {
	release_calls = 0;
	if (crust_find_search((void *)1, "needle", 6, 0, 0, 1) != 0) return -1;
	return release_calls;
}
`;

describe("crust_find_search balances both +1 objects", () => {
	test("the query string and the find configuration are released after WebKit copies them", () => {
		expect(probe(["108_find.c", "109_find_ids.c"], main, "test_find_release")).toBe(2);
	});
});
