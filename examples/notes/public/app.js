/**
 * The page half: a list on the left, an editor on the right, and four commands
 * over the bridge. Plain DOM, no framework, no bundler.
 *
 * This file owns the state machine and the wiring; `api.js` unwraps a command's
 * envelope and writes the status line, `view.js` builds the sidebar. A module
 * has its own scope, so the IIFE is kept only for the early `return` that a page
 * without the bridge takes.
 */
import { createStatus, invoke } from "./api.js";
import { createList } from "./view.js";

(function () {
	"use strict";

	var api = window.crust;
	var editor = document.getElementById("body");
	var titleEl = document.getElementById("title");
	var statusEl = document.getElementById("status");
	var saveEl = document.getElementById("save");
	var formEl = document.getElementById("new-form");
	var nameEl = document.getElementById("new-name");
	var listEl = document.getElementById("notes");

	var status = createStatus(statusEl);
	var show = status.show;
	var report = status.report;
	var list = createList(listEl, nameEl);

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

	function updateTitle() {
		titleEl.textContent = current === null ? "No note selected" : current + (dirty ? " •" : "");
		saveEl.disabled = current === null;
		editor.disabled = current === null;
	}

	/* Commands --------------------------------------------------------- */

	function load() {
		return invoke("notes.list")
			.then(function (value) {
				names = value.names;
				list.render(names, current);
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
				list.render(names, current);
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
				return load().then(list.focusCurrent);
			})
			.catch(function (error) {
				report("Could not delete “" + name + "”", error);
				return load();
			});
	}

	/* Wiring ----------------------------------------------------------- */

	list.bind({ open: openNote, remove: removeNote });

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

	listEl.addEventListener("keydown", list.move);

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
