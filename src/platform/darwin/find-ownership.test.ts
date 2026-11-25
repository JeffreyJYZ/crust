/** Find-in-page through the real ownership audit: a search leaves no owned reference behind. */

import { describe, expect, test } from "bun:test";

import { compileAuditUnit } from "./shim-audit-harness";

const main = `
int test_find(void) {
	crust_find_search((void *)1, "needle", 6, 0, 0, 1);
	return 0;
}
`;

describe("crust_find_search balances both +1 objects", () => {
	test("the query string and the find configuration are released after WebKit copies them", () => {
		const unit = compileAuditUnit(["108_find.c", "109_find_ids.c"], main, ["test_find"]);
		const call = (name: string): number => Number(unit[name]?.() ?? -99999);
		expect(call("test_find")).toBe(0);
		expect(call("shim_audit_balance")).toBe(0);
		expect(call("shim_audit_events")).toBeGreaterThanOrEqual(2);
	});
});
