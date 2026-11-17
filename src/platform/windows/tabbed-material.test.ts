/**
 * `tabbed` is the fourth DWMWA_SYSTEMBACKDROP_TYPE value (4). On Windows we can prove the C parses
 * and the type/validation carry the value; the build gate and HRESULT path are the same as mica.
 */
import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors";
import { fakeShim } from "./fake-shim.ts";
import { shimSource } from "./shim-source.ts";
import { BACKDROP, materialFailure, MIN_MATERIAL_BUILD, openWindow } from "./window-open.ts";

const NEW = `10.0.${MIN_MATERIAL_BUILD}`;

describe("tabbed is the fourth DWM backdrop", () => {
	test("the C accepts kind 4 and the type maps tabbed to 4", () => {
		expect(BACKDROP.tabbed).toBe(4);
		expect(shimSource).toContain("kind != 2 && kind != 3 && kind != 4");
		// The material lane's window-material.test.ts compiles this same assembled unit, so a C
		// syntax break from the kind-4 edit fails that gate without duplicating the cc() call here.
	});

	test("tabbed fails typed on an old build and passes on a modern one", () => {
		const error = materialFailure("tabbed", "10.0.22000");
		expect(error).toBeInstanceOf(CrustError);
		expect(error?.code).toBe("not-implemented");
		expect(error?.message).toContain("tabbed");
		expect(error?.requires).toContain(String(MIN_MATERIAL_BUILD));
		expect(materialFailure("tabbed", NEW)).toBeUndefined();
	});

	test("openWindow sends backdrop 4 to the shim", () => {
		const calls: string[] = [];
		openWindow(fakeShim({}, calls), { label: "main", material: "tabbed" }, "crust", "", NEW);
		expect(calls).toContain("material:100:4");
	});
});
