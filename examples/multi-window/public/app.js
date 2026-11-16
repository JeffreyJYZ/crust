/**
 * One page, three windows: `main` and `inspector` from config, `scout` created at
 * runtime. Each window knows its own label because its URL carries
 * `?window=<label>` — crust appends it for a configured window and for one
 * created at runtime — and `window.label` answers the same label if a page would
 * rather ask than parse its own URL.
 *
 * Every reported line is composed from a `window.*` answer read back *after* the
 * write: the frame line is `getPosition` + `getSize`, never the numbers the page
 * asked for, so a write that landed on another window prints that window's frame.
 */

const own = new URLSearchParams(location.search).get("window") ?? "unknown";

/** One `crust:window` call. A typed refusal is thrown with its code kept. */
function win(command, args) {
	return window.crust.invoke("window", command, args ?? {}).then((answer) => {
		if (answer && answer.ok === true) return answer;
		const code = answer && answer.code ? ` (${answer.code})` : "";
		throw new Error(`window.${command}: ${(answer && answer.message) ?? "refused"}${code}`);
	});
}

/** One line on the backend's stdout, which is where the proof is read. */
function report(line) {
	return window.crust.invoke("report", { line });
}

async function labels() {
	return (await win("list")).labels.join(",");
}

/** x,y,width,height as the platform reports them now. */
async function frameOf(label) {
	const at = await win("getPosition", { label });
	const size = await win("getSize", { label });
	return `${at.x},${at.y},${size.width},${size.height}`;
}

/** The driver, which runs in the `main` window only. */
async function drive() {
	await report(`labels ${await labels()}`);

	await win("create", {
		label: "scout",
		title: "Multi-window — scout",
		width: 360,
		height: 240,
		url: "/?window=scout",
	});
	await report("opened scout");

	// Both commands name `inspector` while this code runs in `main`: an action that
	// fell back to the first window would resize `main` and print its frame instead.
	await win("setPosition", { label: "inspector", x: 100, y: 120 });
	await win("setSize", { label: "inspector", width: 420, height: 300 });
	await report(`inspector frame ${await frameOf("inspector")}`);

	await win("close", { label: "inspector" });
	await report(`closed inspector, labels ${await labels()}`);

	await win("close", { label: "scout" });
	await report(`closed scout, labels ${await labels()}`);
}

/** This window's own identity, every open label, and this window's frame. */
async function paint() {
	document.querySelector("#own").textContent = own;
	document.querySelector("#open").textContent = await labels();
	document.querySelector("#frame").textContent = await frameOf(own);
}

document.querySelector("#resize").addEventListener("click", () => {
	win("setSize", { label: own, width: 520, height: 380 })
		.then(() => paint())
		.catch((error) => {
			document.querySelector("#frame").textContent = error.message;
		});
});

async function main() {
	await paint();
	// The backend answers `ready` only once `run()` has resolved, so the header line
	// is always printed before the first line of the run below.
	while ((await window.crust.invoke("ready")) !== true) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	if (own !== "main") return;
	try {
		await drive();
	} catch (error) {
		await report(`failed ${error.message}`);
	}
}

main().catch((error) => {
	document.querySelector("#frame").textContent = error.message;
});
