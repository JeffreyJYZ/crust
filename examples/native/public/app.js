// The page half: two extension commands, one per dylib. `window.crust.invoke` is the plugin form —
// namespace, command, args — so each answer comes from native code the bridge called, not from
// anything this file can compute. The calls are chained rather than fired together, so the Zig
// answer is always logged before the Rust one and a single probe line proves both arrived.
const zigLine = document.getElementById("zig");
const rustLine = document.getElementById("rust");
const log = document.getElementById("log");

function show(element, label, answer) {
	const state = answer.running ? "running" : "stopped";
	element.textContent = `${label} ${answer.iso} · ${answer.ticks} ticks · ${state} · ${answer.flavor}`;
	const item = document.createElement("li");
	item.textContent = `${label} ${JSON.stringify(answer)}`;
	log.append(item);
}

function fail(element, label, error) {
	element.textContent = `${label} failed`;
	const item = document.createElement("li");
	item.textContent = `${label} failed: ${String(error && error.message ? error.message : error)}`;
	log.append(item);
}

window.crust
	.invoke("zigclock", "now")
	.then((answer) => {
		show(zigLine, "zigclock.now", answer);
		return window.crust.invoke("rustclock", "now");
	})
	.then((answer) => show(rustLine, "rustclock.now", answer))
	.catch((error) => fail(rustLine, "native", error));
