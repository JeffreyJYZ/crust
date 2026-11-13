/**
 * The page. This is the whole point of the example: with `dev.url` the
 * document comes from Vite, so `window.crust` arrives through `crust/vite` and
 * the two-argument app form works exactly as it does on a bridge-served page.
 */
const out = document.querySelector("#out");
const button = document.querySelector("#go");

if (!window.crust) {
	out.textContent = "no window.crust — CRUST_BRIDGE_URL/CRUST_BRIDGE_TOKEN were not set";
} else {
	window.crust.ready.then(() => {
		out.textContent = `bridge ready at ${window.crust.baseUrl || "this origin"}`;
	});

	button.addEventListener("click", async () => {
		out.textContent = "…";
		try {
			// Two arguments: the app form, rewritten to the `app` namespace.
			out.textContent = await window.crust.invoke("greet", { name: "vite" });
		} catch (error) {
			out.textContent = `${error.name}: ${error.message}`;
		}
	});
}
