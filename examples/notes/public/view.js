/**
 * The sidebar: one row per note, the inline delete confirmation, and the arrow
 * keys that move between rows.
 *
 * The list owns no data of its own — `render(names, current)` is told what to
 * show, and the two commands a click can reach arrive through `bind()`, so this
 * module never imports the page's state machine and the page never builds DOM.
 */

/** Nothing is bound yet, so a click before wiring is a no-op rather than a throw. */
function noop() {}

export function createList(listEl, nameEl) {
	var names = [];
	var current = null;
	var handlers = { open: noop, remove: noop };

	/** The page's own handlers: `{ open(name), remove(name) }`. */
	function bind(next) {
		handlers = next;
	}

	/** Show this list, and remember it for the delete confirmation's redraw. */
	function render(nextNames, nextCurrent) {
		names = nextNames;
		current = nextCurrent;
		paint();
	}

	function paint() {
		listEl.textContent = "";

		if (names.length === 0) {
			var empty = document.createElement("li");
			empty.className = "empty";
			empty.textContent = "No notes yet. Add one above.";
			listEl.appendChild(empty);
			return;
		}

		names.forEach(function (name) {
			var row = document.createElement("li");

			var open = document.createElement("button");
			open.type = "button";
			open.className = "note";
			open.textContent = name;
			open.setAttribute("aria-current", name === current ? "true" : "false");
			open.addEventListener("click", function () {
				void handlers.open(name);
			});
			row.appendChild(open);

			var remove = document.createElement("button");
			remove.type = "button";
			remove.className = "delete";
			remove.textContent = "Delete";
			remove.setAttribute("aria-label", "Delete " + name);
			remove.addEventListener("click", function () {
				askDelete(row, name);
			});
			row.appendChild(remove);

			listEl.appendChild(row);
		});
	}

	function askDelete(row, name) {
		row.textContent = "";
		row.className = "confirming";

		var question = document.createElement("span");
		question.className = "confirm-text";
		question.textContent = "Delete “" + name + "”?";

		var yes = document.createElement("button");
		yes.type = "button";
		yes.className = "confirm-yes";
		yes.textContent = "Delete";
		yes.addEventListener("click", function () {
			void handlers.remove(name);
		});

		var no = document.createElement("button");
		no.type = "button";
		no.className = "confirm-no";
		no.textContent = "Cancel";
		no.addEventListener("click", function () {
			paint();
			focusCurrent();
		});

		row.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				event.preventDefault();
				paint();
				focusCurrent();
			}
		});

		row.appendChild(question);
		row.appendChild(yes);
		row.appendChild(no);
		yes.focus();
	}

	/** The open note's row, else the first one, else the name field. */
	function focusCurrent() {
		var target = listEl.querySelector('[aria-current="true"]') || listEl.querySelector(".note");
		if (target) target.focus();
		else nameEl.focus();
	}

	/** Arrow keys, Home and End move between rows and never leave the list. */
	function move(event) {
		if (
			event.key !== "ArrowDown" &&
			event.key !== "ArrowUp" &&
			event.key !== "Home" &&
			event.key !== "End"
		) {
			return;
		}
		var buttons = Array.prototype.slice.call(listEl.querySelectorAll(".note"));
		if (buttons.length === 0) return;
		var index = buttons.indexOf(document.activeElement);
		if (index === -1)
			index = Math.max(
				0,
				buttons.findIndex(function (button) {
					return button.getAttribute("aria-current") === "true";
				}),
			);
		var next = index;
		if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + 1);
		if (event.key === "ArrowUp") next = Math.max(0, index - 1);
		if (event.key === "Home") next = 0;
		if (event.key === "End") next = buttons.length - 1;
		event.preventDefault();
		buttons[next].focus();
	}

	return { bind: bind, render: render, focusCurrent: focusCurrent, move: move };
}
