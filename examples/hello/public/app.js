// A separate script file, loaded from /app.js by the bridge. It reaches the
// page only after crust's runtime has injected the one-name invoke shim at
// <body>, so `invoke("greet", …)` is the app-command form from DESIGN.md §5.
// The plugin form is the three-argument call: name, command, args.
const answer = document.getElementById("answer");
const fromPlugin = document.getElementById("plugin");
const status = document.getElementById("status");

window.crust
	.invoke("greet", { name: "jyz" })
	.then((greeting) => {
		answer.textContent = greeting;
		status.textContent = "answered over the bridge · " + window.crust.baseUrl;
	})
	.catch((error) => {
		answer.textContent = "invoke failed";
		status.textContent = String(error && error.message ? error.message : error);
	});

// The project's own plugin: `greeting` and `greet` are the plugin's namespace
// and command, so this is the same route a third-party plugin uses.
window.crust
	.invoke("greeting", "greet", { name: "jyz" })
	.then((greeting) => {
		fromPlugin.textContent = greeting;
	})
	.catch((error) => {
		fromPlugin.textContent = "plugin invoke failed";
		status.textContent = String(error && error.message ? error.message : error);
	});
