// The page half: the same extension, reached over the bridge. `invoke("clock", "now")` is the
// plugin form — name, command, args — and `listen("clock:tick")` is the event the extension emits
// from its interval. Both go through the same registry `crust dev` and `crust build` filled, so
// this page needs to know nothing about how the extension was loaded.
const reading = document.getElementById("reading");
const log = document.getElementById("log");
const start = document.getElementById("start");
const stop = document.getElementById("stop");

window.crust.listen("clock:tick", (tick) => {
	const line = document.createElement("li");
	line.textContent = `#${tick.tick} every ${tick.everyMs}ms at ${tick.at}`;
	log.prepend(line);
});

function show(label, value) {
	reading.textContent = `${label} → ${JSON.stringify(value)}`;
}

function failed(label, error) {
	show(label, String(error && error.message ? error.message : error));
}

window.crust
	.invoke("clock", "now")
	.then((value) => show("clock.now", value))
	.catch((error) => {
		failed("clock.now failed", error);
	});

start.addEventListener("click", () => {
	window.crust
		.invoke("clock", "startTimer", { everyMs: 500 })
		.then((value) => show("clock.startTimer", value))
		.catch((error) => failed("clock.startTimer failed", error));
});

stop.addEventListener("click", () => {
	window.crust
		.invoke("clock", "stopTimer")
		.then((value) => show("clock.stopTimer", value))
		.catch((error) => failed("clock.stopTimer failed", error));
});
