import { mount } from "svelte";
import App from "./App.svelte";

document.body.style.margin = "0";
document.body.style.background = window.matchMedia("(prefers-color-scheme: light)").matches
	? "#fafafa"
	: "#0e0f11";

const target = document.getElementById("app");
if (!target) throw new Error("svelte: index.html has no #app element");

mount(App, { target });
