/**
 * Production page entry: workload only. The overlay module is injected by the dev harness and
 * bundled by the dev build; this file is the one a production build ships.
 */
import "./workload.js";

window.__probe.start();
const out = document.getElementById("out");
out.textContent = "workload running · independent rAF counter active";
