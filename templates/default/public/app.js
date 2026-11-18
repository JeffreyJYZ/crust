// The bridge injects window.crust into <head>; crust's runtime injects a
// one-name invoke shim at <body>, so this script can call an app command by
// name, exactly as DESIGN.md §5 shows.
// Bind the document before invoking: `lang` drives pronunciation, `dir` flips
// RTL layout. The set is the RTL base languages from the locale rule.
const locale = navigator.language;
document.documentElement.lang = locale;
document.documentElement.dir = /^(ar|ckb|dv|fa|he|ku|ps|sd|ug|ur|yi)(?:-|$)/i.test(locale)
	? "rtl"
	: "ltr";

const answer = document.getElementById("answer");
const status = document.getElementById("status");

window.crust
	.invoke("greet", { name: "crust" })
	.then((greeting) => {
		answer.textContent = greeting;
		status.textContent = "answered over the bridge · " + window.crust.baseUrl;
	})
	.catch((error) => {
		answer.textContent = "invoke failed";
		status.textContent = String(error && error.message ? error.message : error);
	});
