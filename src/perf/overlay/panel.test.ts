import { describe, expect, test } from "bun:test";
import { bridgeStore, createPanel, type DocumentLike, type ElementLike } from "./panel.ts";

/** A DOM whose layout counts only in-flow children, so a `position:fixed` panel is invisible to it. */
function fakeDom() {
	const body = {
		style: {},
		textContent: "",
		children: [] as ElementLike[],
		appendChild(child: ElementLike) {
			this.children.push(child);
		},
		addEventListener() {},
		remove() {},
		getBoundingClientRect: () => ({ top: 20, height: 20 }),
	};
	const doc: DocumentLike = {
		body,
		createElement(tag: string): ElementLike {
			const listeners = new Map<string, (e: { clientX: number; clientY: number }) => void>();
			const children: ElementLike[] = [];
			return {
				style: {},
				textContent: tag === "canvas" ? "" : "",
				children,
				appendChild(child: ElementLike) {
					children.push(child);
				},
				addEventListener(type, fn) {
					listeners.set(type, fn);
				},
				remove() {},
				fire(type: string, x: number, y: number) {
					listeners.get(type)?.({ clientX: x, clientY: y });
				},
			} as ElementLike & { fire: (type: string, x: number, y: number) => void };
		},
	};
	const scrollHeight = (): number =>
		100 + body.children.filter((c) => c.style.position !== "fixed").length * 20;
	return { doc, body, scrollHeight, root: () => body.children.at(-1)! };
}

describe("fixed overlay panel", () => {
	test("showing the panel does not reflow the document", () => {
		const d = fakeDom();
		const before = { height: d.scrollHeight(), rect: d.body.getBoundingClientRect() };
		const panel = createPanel({ doc: d.doc });
		const after = { height: d.scrollHeight(), rect: d.body.getBoundingClientRect() };
		expect(after).toEqual(before);
		expect(d.root().style.position).toBe("fixed");
		expect(d.root().style.contain).toContain("layout");
		panel.show();
		expect(d.root().style.display).toBe("block");
		expect(d.scrollHeight()).toBe(before.height);
		panel.destroy();
	});

	test("corner comes from the store and dragging persists through transform only", async () => {
		const d = fakeDom();
		const written: Array<{ key: string; value: unknown }> = [];
		const panel = createPanel({
			doc: d.doc,
			store: {
				async get() {
					return { x: 40, y: 60 };
				},
				async set(key, value) {
					written.push({ key, value });
					return value;
				},
			},
		});
		await Bun.sleep(0);
		expect(d.root().style.transform).toBe("translate3d(40px, 60px, 0)");
		const header = (d.root() as unknown as { children: Array<{ fire: (t: string, x: number, y: number) => void }> }).children[0]!;
		header.fire("pointerdown", 0, 0);
		header.fire("pointermove", 10, 5);
		expect(d.root().style.transform).toBe("translate3d(50px, 65px, 0)");
		header.fire("pointerup", 10, 5);
		await Bun.sleep(0);
		expect(written).toEqual([{ key: "perf-overlay.corner", value: { x: 50, y: 65 } }]);
		panel.destroy();
	});

	test("update renders one text block and feeds the sparkline", () => {
		const d = fakeDom();
		const panel = createPanel({ doc: d.doc });
		panel.update(["fps 55", "p95 26"], 26, 1000);
		expect(panel.text()).toBe("fps 55\np95 26");
		expect(panel.spark.count).toBe(1);
		expect(panel.spark.overBudget).toBe(false);
		panel.update(["fps 20", "p95 40"], 40, 2000);
		expect(panel.spark.overBudget).toBe(true);
		panel.destroy();
	});

	test("bridgeStore degrades when there is no bridge", async () => {
		expect(bridgeStore(undefined)).toBeUndefined();
		const calls: string[] = [];
		const store = bridgeStore({
			invoke: async (plugin: string, command: string) => {
				calls.push(`${plugin}.${command}`);
				if (command === "get") return { value: { x: 1, y: 2 } };
				return {};
			},
		})!;
		expect(await store.get("perf-overlay.corner")).toEqual({ x: 1, y: 2 });
		await store.set("perf-overlay.corner", { x: 1, y: 2 });
		expect(calls).toEqual(["store.get", "store.set"]);
	});
});
