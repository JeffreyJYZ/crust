/**
 * The page the `testing` suites share: a button, a field and a box, laid out so a point can hit
 * them. A fixture rather than a copy in each suite, so a selector or a rectangle only moves once.
 */

import { FakeDocument, FakeElement, FakeInput, fakeAdapter, type FakePage } from "./testing-fake";

export interface TestPage extends FakePage {
	button: FakeElement;
	field: FakeInput;
	box: FakeElement;
}

export function testPage(): TestPage {
	const fake = fakeAdapter(new FakeDocument());
	const button = new FakeElement("button", { id: "go" });
	button.textContent = "Run";
	button.rect = { left: 10, top: 10, width: 80, height: 30 };
	button.setAttribute("data-testid", "go");
	const field = new FakeInput("input", { id: "name" });
	field.rect = { left: 10, top: 60, width: 200, height: 24 };
	const box = new FakeElement("div", { id: "box" });
	box.textContent = "  boxed  ";
	box.rect = { left: 10, top: 100, width: 50, height: 50 };
	fake.document.body.append(button, field, box);
	return Object.assign(fake, { button, field, box });
}
