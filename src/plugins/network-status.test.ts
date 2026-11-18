/**
 * `crust:network`'s connectivity half: `status()` and `onChange()`. These are the two commands that
 * answer "does this machine have a path to the network", which is a different question from the
 * interception four — the namesake the coverage audit found, where crust only had the interceptor.
 *
 * Every test injects a fake adapter, so no reachability target and no dispatch queue is installed.
 */

import { describe, expect, test } from "bun:test";

import { isNotImplemented } from "@/plugins/define.ts";
import { fakeNetwork, ok, recorder } from "@/plugins/network-fake.ts";
import { createNetworkPlugin } from "@/plugins/network.ts";
import {
	NETWORK_CHANGE_EVENT,
	platformRequires,
	type NetworkStatus,
	type NetworkStatusAdapter,
} from "@/plugins/network-status.ts";
import { onlineFromFlags, REACHABILITY_FLAGS } from "@/platform/darwin/network-status.ts";

interface FakeStatus {
	adapter: NetworkStatusAdapter;
	/** Drive the observer the way SystemConfiguration would. */
	report: (status: NetworkStatus) => void;
}

function fakeStatus(
	status: NetworkStatus = { online: true, interfaceKinds: ["wifi"] },
	installed = true,
): FakeStatus {
	let listener: ((status: NetworkStatus) => void) | undefined;
	return {
		adapter: {
			requires: "SCNetworkReachability in SystemConfiguration",
			status: () => status,
			onChange: (next) => {
				listener = next;
				return installed;
			},
		},
		report: (next) => listener?.(next),
	};
}

describe("network status", () => {
	test("status() reports the OS answer beside the interceptor's own commands", async () => {
		const status = fakeStatus({ online: false, interfaceKinds: ["wired"] });
		const plugin = createNetworkPlugin(fakeNetwork().adapter, {}, status.adapter);
		expect(await plugin.commands.status({}, recorder().ctx)).toEqual({
			ok: true,
			online: false,
			interfaceKinds: ["wired"],
		});
		// The four interception commands are untouched by the new pair.
		expect(ok(await plugin.commands.rules({}, recorder().ctx)).scheme).toBe("crust-net");
	});

	test("status() without an adapter names the platform call", async () => {
		const status = await createNetworkPlugin().commands.status({}, recorder().ctx);
		expect(isNotImplemented(status)).toBe(true);
		if (isNotImplemented(status)) expect(status.requires).toBe(platformRequires());
	});

	test("onChange() emits network:change with the new status", async () => {
		const status = fakeStatus();
		const { ctx, events } = recorder();
		const plugin = createNetworkPlugin(fakeNetwork().adapter, {}, status.adapter);
		expect(await plugin.commands.onChange({}, ctx)).toEqual({
			ok: true,
			event: NETWORK_CHANGE_EVENT,
		});
		status.report({ online: false, interfaceKinds: [] });
		expect(events).toEqual([
			{ event: "network:change", data: { online: false, interfaceKinds: [] } },
		]);
	});

	test("a refused observer is not-implemented naming the call, not a silent subscription", async () => {
		const status = fakeStatus({ online: true, interfaceKinds: [] }, false);
		const plugin = createNetworkPlugin(fakeNetwork().adapter, {}, status.adapter);
		const answer = await plugin.commands.onChange({}, recorder().ctx);
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) {
			expect(answer.requires).toBe("SCNetworkReachability in SystemConfiguration");
		}
	});

	test("a page handler that throws does not unwind into the native callback", async () => {
		const status = fakeStatus();
		const ctx = {
			emit: () => {
				throw new Error("page handler");
			},
		};
		const plugin = createNetworkPlugin(fakeNetwork().adapter, {}, status.adapter);
		await plugin.commands.onChange({}, ctx);
		expect(() => status.report({ online: false, interfaceKinds: [] })).not.toThrow();
	});

	test("the reachability flags decode the way Apple documents them", () => {
		const { reachable, connectionRequired } = REACHABILITY_FLAGS;
		expect(onlineFromFlags(reachable)).toBe(true);
		expect(onlineFromFlags(reachable | connectionRequired)).toBe(false);
		expect(onlineFromFlags(0)).toBe(false);
		expect(onlineFromFlags(-1)).toBe(false);
	});

	test("a refusal names the call the platform is missing, not a generic gap", () => {
		expect(platformRequires("linux")).toBe(
		"GNetworkMonitor in GIO (libgio-2.0.so.0, loaded through libgtk-3)",
	);
		expect(platformRequires("win32")).toBe("INetworkListManager in NetworkListManager");
		expect(platformRequires("freebsd")).toBe("an OS network status API");
	});

	test("the runtime registers both halves, and status reads the real OS path", async () => {
		const { darwinNetworkPlugin } = await import("@/runtime-network.ts");
		const plugin = darwinNetworkPlugin();
		const status = await plugin.commands.status?.({}, recorder().ctx);
		expect(isNotImplemented(status)).toBe(false);
		if (!isNotImplemented(status) && status.ok) {
			expect(typeof status.online).toBe("boolean");
			expect(Array.isArray(status.interfaceKinds)).toBe(true);
			for (const kind of status.interfaceKinds) {
				expect(["wifi", "wired", "cellular", "other"]).toContain(kind);
			}
		}
		// The interceptor is still there beside it, and still refuses without a configuration.
		expect(isNotImplemented(await plugin.commands.rules({}, recorder().ctx))).toBe(false);
	});
});
