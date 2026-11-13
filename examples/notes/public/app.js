/**
 * The page half: a list on the left, an editor on the right, and four commands
 * over the bridge. Plain DOM, no framework, no bundler.
 *
 * Every command answers with `{ ok: true, value }` or `{ ok: false, code,
 * message }`, so a refused name is data the page can show, not an exception
 * that loses its reason. `invoke()` below is the only place that unwraps it.
 */
(function () {
	"use strict";

	var api = window.crust;
	var listEl = document.getElementById("notes");
	var editor = document.getElementById("body");
	var titleEl = document.getElementById("title");
	var statusEl = document.getElementById("status");
	var saveEl = document.getElementById("save");
	var formEl = document.getElementById("new-form");
	var nameEl = document.getElementById("new-name");

	/** The open note's name, or null. */
	var current = null;
	/** Editor text differs from what is on disk. */
	var dirty = false;
	/** Names in the sidebar, newest list from notes.list. */
	var names = [];

	if (!api || typeof api.invoke !== "function") {
		show("This page needs the crust bridge — open it with `crust dev`.", "error");
		editor.placeholder = "No bridge: window.crust is missing.";
		return;
	}

	function show(text, tone) {
		statusEl.textContent = text || "";
		statusEl.className = "status" + (tone ? " " + tone : "");
	}

	function invoke(name, args) {
		return api.invoke(name, args || {}).then(function (reply) {
			if (!reply || typeof reply !== "object") {
				throw new Error(name + ": the bridge returned no result");
			}
			if (!reply.ok) {
				var error = new Error(reply.message || reply.code || name + " failed");
				error.code = reply.code;
				throw error;
			}
			return reply.value;
		});
	}

	function report(prefix, error) {
		var code = error && error.code ? " (" + error.code + ")" : "";
		show(prefix + ": " + (error && error.message ? error.message : String(error)) + code, "error");
	}

	function updateTitle() {
		titleEl.textContent = current === null ? "No note selected" : current + (dirty ? " •" : "");
		saveEl.disabled = current === null;
		editor.disabled = current === null;
	}

	/* List ------------------------------------------------------------- */

	function renderList() {
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
				void openNote(name);
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
			void removeNote(name);
		});

		var no = document.createElement("button");
		no.type = "button";
		no.className = "confirm-no";
		no.textContent = "Cancel";
		no.addEventListener("click", function () {
			renderList();
			focusCurrent();
		});

		row.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				event.preventDefault();
				renderList();
				focusCurrent();
			}
		});

		row.appendChild(question);
		row.appendChild(yes);
		row.appendChild(no);
		yes.focus();
	}

	function focusCurrent() {
		var target =
			listEl.querySelector('[aria-current="true"]') || listEl.querySelector(".note");
		if (target) target.focus();
		else nameEl.focus();
	}

	/* Commands --------------------------------------------------------- */

	function load() {
		return invoke("notes.list")
			.then(function (value) {
				names = value.names;
				renderList();
			})
			.catch(function (error) {
				report("Could not list notes", error);
			});
	}

	function openNote(name) {
		if (dirty && name !== current) {
			show("Unsaved changes in “" + current + "” — save with ⌘S, then switch.", "error");
			return Promise.resolve();
		}
		if (name === current) {
			editor.focus();
			return Promise.resolve();
		}

		return invoke("notes.read", { name: name })
			.then(function (value) {
				current = value.name;
				dirty = false;
				editor.value = value.text;
				updateTitle();
				renderList();
				show(value.text.length > 0 ? "" : "empty note", "");
				editor.focus();
				editor.setSelectionRange(editor.value.length, editor.value.length);
			})
			.catch(function (error) {
				report("Could not open “" + name + "”", error);
				void load();
			});
	}

	function save() {
		if (current === null) return Promise.resolve();
		if (!dirty) {
			show("already saved", "saved");
			return Promise.resolve();
		}

		saveEl.disabled = true;
		return invoke("notes.write", { name: current, text: editor.value })
			.then(function (value) {
				dirty = false;
				updateTitle();
				show("saved · " + value.bytes + " bytes", "saved");
				return load();
			})
			.catch(function (error) {
				report("Could not save", error);
			})
			.finally(function () {
				updateTitle();
			});
	}

	function create(name) {
		if (names.indexOf(name) !== -1) {
			show("“" + name + "” already exists.", "error");
			return Promise.resolve();
		}

		return invoke("notes.write", { name: name, text: "" })
			.then(function (value) {
				nameEl.value = "";
				current = value.name;
				dirty = false;
				editor.value = "";
				return load().then(function () {
					updateTitle();
					editor.focus();
					show("created “" + value.name + "”", "saved");
					return value.name;
				});
			})
			.catch(function (error) {
				report("Could not create the note", error);
			});
	}

	function removeNote(name) {
		return invoke("notes.remove", { name: name })
			.then(function () {
				if (current === name) {
					current = null;
					dirty = false;
					editor.value = "";
					updateTitle();
				}
				show("deleted “" + name + "”", "");
				return load().then(focusCurrent);
			})
			.catch(function (error) {
				report("Could not delete “" + name + "”", error);
				return load();
			});
	}

	/* Wiring ----------------------------------------------------------- */

	formEl.addEventListener("submit", function (event) {
		event.preventDefault();
		var name = nameEl.value.trim();
		if (name.length === 0) {
			show("type a name first", "error");
			nameEl.focus();
			return;
		}
		void create(name);
	});

	saveEl.addEventListener("click", function () {
		void save();
	});

	editor.addEventListener("input", function () {
		dirty = true;
		updateTitle();
		show("unsaved — ⌘S", "");
	});

	listEl.addEventListener("keydown", function (event) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
			return;
		}
		var buttons = Array.prototype.slice.call(listEl.querySelectorAll(".note"));
		if (buttons.length === 0) return;
		var index = buttons.indexOf(document.activeElement);
		if (index === -1) index = Math.max(0, buttons.findIndex(function (button) {
			return button.getAttribute("aria-current") === "true";
		}));
		var next = index;
		if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + 1);
		if (event.key === "ArrowUp") next = Math.max(0, index - 1);
		if (event.key === "Home") next = 0;
		if (event.key === "End") next = buttons.length - 1;
		event.preventDefault();
		buttons[next].focus();
	});

	document.addEventListener("keydown", function (event) {
		if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "s") {
			event.preventDefault();
			void save();
		}
	});

	window.addEventListener("beforeunload", function (event) {
		if (!dirty) return;
		event.preventDefault();
		event.returnValue = "";
	});

	updateTitle();
	void load();
})();
