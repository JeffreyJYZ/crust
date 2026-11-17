/**
 * A real keychain round trip, in a child process because `SecItemAdd`/`SecItemCopyMatching` touch
 * the user's login keychain: the test deletes what it wrote, and a crash mid-run must not take the
 * runner down with it.
 *
 * This exists because the sweep found the defect it pins. `shim_keychain_get` built the
 * class/service/account query and then a *second* dictionary holding only `kSecReturnData` and
 * `kSecMatchLimit`, and searched with the second — a query that names no class says nothing about
 * what to look for, so every read answered -3 and a secret written by `set` could never be read back.
 * The plugin suite passed because its fake adapter never ran the C.
 */
import { describe, expect, test } from "bun:test";

const REPO = new URL("..", import.meta.url).pathname;
const SRC = new URL(".", import.meta.url).pathname;

const SCRIPT = `
import { darwinKeychainShim } from "${SRC}keychain-ffi.ts";

const shim = darwinKeychainShim();
const service = "crust.sweep.live";
const account = "round-trip";
const secret = "s3cr3t-value";

const out = [];
const say = (line) => out.push(line);
say("available=" + shim.available());

shim.delete(service, account); // a leftover from an interrupted run must not fail the write
say("set=" + shim.set(service, account, secret));

const buffer = new Uint8Array(512);
const length = shim.get(service, account, buffer);
say("length=" + length);
say("secret=" + (length > 0 ? new TextDecoder().decode(buffer.subarray(0, length)) : ""));

const names = new Uint8Array(1024);
const listed = shim.list?.(service, names) ?? -1;
say("listed=" + listed);
if (listed > 0) {
  const text = new TextDecoder().decode(names.subarray(0, listed));
  say("accounts=" + JSON.stringify(text.split("\\0").filter(Boolean)));
}

say("delete=" + shim.delete(service, account));
const after = shim.get(service, account, new Uint8Array(512));
say("after-delete=" + after);
console.log(out.join("\\n"));
process.exit(0);
`;

describe("the darwin keychain unit round-trips a real secret", () => {
	test("set then get returns the bytes, list names the account, delete removes it", async () => {
		const child = Bun.spawn(["bun", "-e", SCRIPT], {
			cwd: REPO,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CRUST_TEST_CHILD: "1" },
		});
		const out = await new Response(child.stdout).text();
		const err = await new Response(child.stderr).text();
		await child.exited;
		if (child.exitCode !== 0) console.log(`keychain child exited: ${err.slice(0, 400)}`);

		expect(out).toContain("available=true");
		expect(out).toContain("set=0");
		// The defect this pins: -3 meant "could not build a query", so a stored secret was unreadable.
		expect(out).toContain("length=12");
		expect(out).toContain("secret=s3cr3t-value");
		expect(out).toContain("listed=");
		expect(out).toContain('accounts=["round-trip"]');
		expect(out).toContain("delete=1");
		// "Not stored" is -1, which the plugin turns into `{ found: false }` rather than an error.
		expect(out).toContain("after-delete=-1");
		expect(child.exitCode).toBe(0);
	}, 30_000);
});
