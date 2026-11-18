import { createApp } from "vue";
import App from "./App.vue";

// Bind the document to the configured language: `lang` drives pronunciation, `dir` flips RTL
// layout. A page that wires `crust:i18n` can rebind both from `i18n.locale`'s `lang`/`dir`.
const locale = navigator.language;
document.documentElement.lang = locale;
document.documentElement.dir = /^(ar|ckb|dv|fa|he|ku|ps|sd|ug|ur|yi)(?:-|$)/i.test(locale)
	? "rtl"
	: "ltr";

document.body.style.margin = "0";
document.body.style.background = window.matchMedia("(prefers-color-scheme: light)").matches
	? "#fafafa"
	: "#0e0f11";

const target = document.getElementById("app");
if (!target) throw new Error("vue: index.html has no #app element");

createApp(App).mount(target);
