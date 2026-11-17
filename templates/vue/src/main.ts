import { createApp } from "vue";
import App from "./App.vue";

document.body.style.margin = "0";
document.body.style.background = window.matchMedia("(prefers-color-scheme: light)").matches
	? "#fafafa"
	: "#0e0f11";

const target = document.getElementById("app");
if (!target) throw new Error("vue: index.html has no #app element");

createApp(App).mount(target);
