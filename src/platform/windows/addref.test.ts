/**
 * The COM reference rule this layer broke for ten rounds: the out-parameter of a completion handler is
 * *borrowed*. WebView2 drops its reference when our `Invoke` returns, so anything kept past the callback
 * must be AddRef'd first — otherwise the environment is freed under us and every later call reads
 * recycled memory.
 *
 * Split from `handler.test.ts` when that file outgrew the line cap.
 */
import { describe, expect, test } from "bun:test";
import { readShimPart, readShimSource } from "./shim-source.ts";

const source = readShimSource();
const com = readShimPart("30_com.c");

describe("a borrowed out-parameter is AddRef'd before it is stored", () => {
	/**
	 * WebView2 drops its reference to a completion handler's out-parameter the moment `Invoke` returns.
	 * Ten rounds were spent on thread ids and vtable slots before this: the environment was freed under
	 * us, the controller it handed back was borrowed too, and by the time we read either one the memory
	 * had been recycled — `0xffffffff` where a vtable belongs, `UI_E_WRONG_THREAD` from a dead object.
	 */
	test("AddRef happens through the guard, on slot 1, before the store", () => {
		expect(com).toContain("static int handler_addref_object(void *obj) {");
		expect(com).toContain("shim_object_vtbl(obj)");
		expect(com).toContain("shim_slot_ok(vt, SHIM_SLOT_IUNKNOWN_ADDREF)");
		expect(source).toContain("#define SHIM_SLOT_IUNKNOWN_ADDREF 1");

		const body = com.slice(com.indexOf("static shim_i64 handler_invoke("));
		const addref = body.indexOf("h->addref = handler_addref_object(created);");
		const store = body.indexOf("h->result = h->addref > 0 ? created : 0;");
		expect(addref).toBeGreaterThan(-1);
		expect(store).toBeGreaterThan(-1);
		expect(addref).toBeLessThan(store);
	});

	/** A reference that could not be taken must not be stored as an object. */
	test("a refused AddRef stores no object", () => {
		expect(com).toContain("h->result = h->addref > 0 ? created : 0;");
		expect(com).toContain("if (!vt) return -1;");
	});

	/** Nothing balances the refcount: these objects live for the process, like the loader handle. */
	test("the layer never Releases a WebView2 object", () => {
		expect(source).not.toContain("SHIM_SLOT_IUNKNOWN_RELEASE");
		expect(source).not.toMatch(/vt\[2\]\)/);
		expect(source).not.toMatch(/handler_release\(g_/);
	});

	/** The next run proves it: the refcount AddRef answered, per step. */
	test("the refcount is readable per step", () => {
		expect(source).toContain("int shim_handler_addref(int step)");
		expect(source).toContain("return g_env_handler.addref;");
		expect(source).toContain("return g_ctrl_handler.addref;");
	});
});
