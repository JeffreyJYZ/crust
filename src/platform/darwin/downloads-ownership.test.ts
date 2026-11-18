/** The downloads half of native-surface.md: the +1 NSString, completion identity, class failure. */

import { describe, expect, test } from "bun:test";

import { DOWNLOADS, probe, probeWith, STUB_CLASS } from "./ownership-harness";

describe("the downloads shim balances the NSString it hands to NSURL", () => {
	const main = `
int test_downloads(void) {
	int served;
	release_calls = 0;
	dl_file_url("/tmp/a", 6);
	served = release_calls;
	release_calls = 0;
	dl_delegate = (void *)1;
	dl_start((void *)1, "https://example.test", 20);
	return served * 100 + release_calls;
}
`;
	test("dl_file_url and dl_start each release their +1 string", () => {
		expect(probe(DOWNLOADS, main, "test_downloads")).toBe(101);
	});
});

describe("a completion belongs to its own start, not to a FIFO queue", () => {
	// The token must travel with the block WebKit keeps: WebKit promises no ordering for these
	// handlers, so a second start completing first cannot be given the first start's token.
	const main = `
struct test_block { void *isa; int flags; int reserved; void *invoke; void *desc; long long token; };
static struct test_block b_first, b_second;
int test_order(void) {
	long s;
	dl_delegate = (void *)1;
	if (dl_start((void *)9, "https://a.test", 14) != 1) return -1;
	if (dl_start((void *)9, "https://b.test", 14) != 2) return -2;
	b_second.token = 2;
	dl_start_done(&b_second, (void *)5001);
	s = dl_slot_of((void *)5001);
	if (s < 0) return -4;
	if (dl_tokens[s] != 2) return -5;
	b_first.token = 1;
	dl_start_done(&b_first, (void *)5000);
	s = dl_slot_of((void *)5000);
	if (s < 0) return -6;
	if (dl_tokens[s] != 1) return -7;
	return 100;
}
`;
	test("out-of-order completions map to the token each start minted", () => {
		expect(probe(DOWNLOADS, main, "test_order")).toBe(100);
	});
});

describe("a failed download class registration does not wedge the unit", () => {
	const main = `
int test_dl_class(void) {
	fail_add = 1;
	if (dl_install((void *)7) != 0) return -1;
	if (dispose_calls != 1) return -2;
	if (dl_install((void *)7) != 1) return -3;
	return 100 + allocate_calls;
}
`;
	test("dl_install disposes the half-built class and a retry succeeds", () => {
		expect(probeWith(STUB_CLASS, DOWNLOADS, main, "test_dl_class")).toBe(102);
	});
});
