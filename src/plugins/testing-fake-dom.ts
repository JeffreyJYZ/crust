/**
 * A page small enough to read: the DOM the `testing` scripts are evaluated against when no window
 * exists. `testing-fake-document.ts` adds the document root and `testing-fake.ts` the adapter.
 *
 * It reproduces the two shapes the scripts depend on — a prototype `value` accessor on inputs and
 * bubbling dispatch — because those are what make `type`'s native-setter rule measurable. Selectors
 * cover `#id`, `.class`, `tag`, `tag#id`, `[name]` and `[name="value"]`: enough for the plugin's own
 * tests, and deliberately not a CSS engine.
 */

import type { FakeDocument } from "./testing-fake-document.ts";

export class FakeEvent {
	readonly type: string;
	readonly bubbles: boolean;
	/** Stamped by `FakeElement.dispatchEvent`, the way a real event knows its own target. */
	target: FakeElement | FakeDocument | undefined;
	readonly clientX: number;
	readonly clientY: number;
	readonly key: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	defaultPrevented = false;

	constructor(type: string, init: Record<string, unknown> = {}) {
		this.type = type;
		this.bubbles = init.bubbles === true;
		this.clientX = typeof init.clientX === "number" ? init.clientX : 0;
		this.clientY = typeof init.clientY === "number" ? init.clientY : 0;
		this.key = typeof init.key === "string" ? init.key : "";
		this.altKey = init.altKey === true;
		this.ctrlKey = init.ctrlKey === true;
		this.metaKey = init.metaKey === true;
		this.shiftKey = init.shiftKey === true;
	}

	preventDefault(): void {
		this.defaultPrevented = true;
	}
}

type Listener = (event: FakeEvent) => void;

function matches(element: FakeElement, selector: string): boolean {
	const trimmed = selector.trim();
	const id = /^#([\w-]+)$/.exec(trimmed);
	if (id) return element.id === (id[1] ?? "");
	const className = /^\.([\w-]+)$/.exec(trimmed);
	if (className) return element.className.split(/\s+/).includes(className[1] ?? "");
	const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(trimmed);
	if (attribute) {
		const name = attribute[1] ?? "";
		return attribute[2] === undefined
			? element.hasAttribute(name)
			: element.getAttribute(name) === attribute[2];
	}
	const compound = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?(?:\.([\w-]+))?$/.exec(trimmed);
	if (!compound) return false;
	if (compound[1] && element.tagName.toLowerCase() !== compound[1].toLowerCase()) return false;
	if (compound[2] && element.id !== compound[2]) return false;
	if (compound[3] && !element.className.split(/\s+/).includes(compound[3])) return false;
	return true;
}

export class FakeElement {
	readonly tagName: string;
	readonly attributes: { name: string; value: string }[] = [];
	readonly children: FakeElement[] = [];
	readonly listeners = new Map<string, Listener[]>();
	readonly style: Record<string, string> = {};
	rect = { left: 0, top: 0, width: 100, height: 20 };
	textContent = "";
	focused = false;
	clicks = 0;
	scrolls = 0;
	parent: FakeElement | undefined;
	private owner: FakeDocument | undefined;

	constructor(tagName: string, attributes: Record<string, string> = {}) {
		this.tagName = tagName.toUpperCase();
		for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
	}

	/** The document this element belongs to, set by `append`. */
	attach(owner: FakeDocument): this {
		this.owner = owner;
		for (const child of this.children) child.attach(owner);
		return this;
	}

	append(...children: FakeElement[]): this {
		for (const child of children) {
			child.parent = this;
			if (this.owner) child.attach(this.owner);
			this.children.push(child);
		}
		return this;
	}

	get id(): string {
		return this.getAttribute("id") ?? "";
	}

	get className(): string {
		return this.getAttribute("class") ?? "";
	}

	set className(value: string) {
		this.setAttribute("class", value);
	}

	getAttribute(name: string): string | undefined {
		return this.attributes.find((entry) => entry.name === name)?.value;
	}

	setAttribute(name: string, value: string): void {
		const found = this.attributes.find((entry) => entry.name === name);
		if (found) found.value = value;
		else this.attributes.push({ name, value });
	}

	hasAttribute(name: string): boolean {
		return this.attributes.some((entry) => entry.name === name);
	}

	getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
		return { ...this.rect };
	}

	getClientRects(): unknown[] {
		return this.rect.width > 0 || this.rect.height > 0 ? [{ ...this.rect }] : [];
	}

	scrollIntoView(): void {
		this.scrolls += 1;
	}

	focus(): void {
		this.focused = true;
		if (this.owner) this.owner.activeElement = this;
	}

	click(): void {
		this.clicks += 1;
		this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
	}

	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(listener);
		this.listeners.set(type, list);
	}

	dispatchEvent(event: FakeEvent): boolean {
		if (event.target === undefined) event.target = this;
		const list = this.listeners.get(event.type) ?? [];
		for (const listener of list) listener(event);
		if (event.bubbles && this.parent) this.parent.dispatchEvent(event);
		return true;
	}

	matches(selector: string): boolean {
		return matches(this, selector);
	}
}

export class FakeInput extends FakeElement {
	private typed = "";

	get value(): string {
		return this.typed;
	}

	set value(next: string) {
		this.typed = String(next);
	}
}

export class FakeTextArea extends FakeInput {}

