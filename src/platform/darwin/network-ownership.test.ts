/** The network half of native-surface.md: owned objects per serve/refusal, and a failed registration. */

import { describe, expect, test } from "bun:test";

import { NETWORK, probe, probeWith, STUB_CLASS } from "./ownership-harness";

describe("the network shim balances every +1 object it creates", () => {
	const main = `
static long fill_stub(char *body, int bodyCap, char *mime, int mimeCap) {
	(void)bodyCap; (void)mimeCap;
	body[0] = 'o'; body[1] = 'k';
	mime[0] = 't'; mime[1] = 'x'; mime[2] = 't';
	return 2;
}
int test_serve(void) {
	release_calls = 0; alloc_calls = 0;
	net_fill = fill_stub;
	return net_serve((void *)7, (void *)8) ? release_calls : -1000 - release_calls;
}
int test_fail(void) {
	release_calls = 0;
	net_fail((void *)7, -999);
	return release_calls;
}
`;
	// 7 NSString + 1 NSData + 1 NSHTTPURLResponse, each alloc/init and each released.
	test("a served request releases all nine owned objects", () => {
		expect(probe(NETWORK, main, "test_serve")).toBe(9);
	});
	// The domain is +1; NSError is an autoreleased convenience object and is not released here.
	test("a refused task releases its domain once", () => {
		expect(probe(NETWORK, main, "test_fail")).toBe(1);
	});
});

describe("a failed network class registration does not wedge the unit", () => {
	const main = `
int test_net_class(void) {
	fail_add = 1;
	if (net_install((void *)7, "crust-net", 9, (void *)3, (void *)4) != 0) return -1;
	if (dispose_calls != 1) return -2;
	if (net_install((void *)7, "crust-net", 9, (void *)3, (void *)4) != 1) return -3;
	return 100 + allocate_calls;
}
`;
	test("net_install disposes the half-built class and a retry succeeds", () => {
		expect(probeWith(STUB_CLASS, NETWORK, main, "test_net_class")).toBe(102);
	});
});
