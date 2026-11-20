import { render } from "@solidjs/web";

import { App } from "./App";

// Bind the document to the configured language: `lang` drives pronunciation, `dir` flips RTL
// layout. A page that wires `crust:i18n` can rebind both from `i18n.locale`'s `lang`/`dir`.
const locale = navigator.language;
document.documentElement.lang = locale;
document.documentElement.dir = /^(ar|ckb|dv|fa|he|ku|ps|sd|ug|ur|yi)(?:-|$)/i.test(locale)
	? "rtl"
	: "ltr";

document.body.style.margin = "0";

const container = document.getElementById("root");
if (!container) throw new Error("solid: index.html has no #root element");

// Solid 2 moved the DOM renderer out of `solid-js/web` into `@solidjs/web`.
render(() => <App />, container);
