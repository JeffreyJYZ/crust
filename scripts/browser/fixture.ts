/**
 * The scratch project the browser proof runs: a config that allow-lists only the probe's own server,
 * a backend whose only job is to print what the page reports, and a driver page that exercises every
 * command. Kept out of `e2e-browser.ts` so the run and its assertions read on their own.
 */

/** The remote document the surface loads: a title to read, a capture request to deny, a popup. */
export const REMOTE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Remote Title</title></head>
<body><h1>remote content</h1>
<script>
  setTimeout(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => { document.title = "capture granted"; })
      .catch((error) => { document.title = "capture denied " + error.name; });
  }, 500);
  setTimeout(() => { window.open("/popup", "_blank"); }, 1500);
</script></body></html>`;

export const POPUP_PAGE = `<!doctype html><html><head><title>Popup</title></head><body>popup</body></html>`;

export function configSource(origin: string): string {
	return `import type { CrustConfig } from "crust";

export default {
  app: { id: "land.jyz.e2e-browser", name: "Browser crust", version: "0.1.0" },
  windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Browser crust" }],
  browser: { origins: [${JSON.stringify(origin)}] },
  security: {
    capabilities: [
      { name: "browser", actions: ["browser:*"] },
      { name: "window", actions: ["window:*"] },
      { name: "app", actions: ["app:report"] },
    ],
    grants: { main: ["browser", "window", "app"] },
  },
} satisfies CrustConfig;
`;
}

/** The backend is the probe's own log: one `  page      <line>` per answer the page reports. */
export const MAIN_SOURCE = `import { app } from "crust";

app.command("report", (args) => {
  console.log("  page      " + String(args.line ?? ""));
  return "printed";
});

app.on("window-all-closed", () => app.quit());
await app.run();
`;

/**
 * The driver page. It opens the surface, reads the title, captures before and after `setBounds`,
 * asks for a foreign origin, waits for the capture denial, then waits for the popup event before
 * reading `window.list` — so the count is taken after the popup had every chance to make a window.
 */
export function pageSource(origin: string): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Driver</title></head><body>
<script>
(async () => {
  const report = (line) => window.crust.invoke("report", { line });
  const invoke = (name, args) => window.crust.invoke("browser", name, args)
    .catch((error) => ({ ok: false, rejected: error.code || String(error) }));
  await window.crust.ready;
  const remote = ${JSON.stringify(origin)};
  let popupEvent = null;
  const popupSeen = new Promise((resolve) => {
    window.crust.listen("browser:popup", (event) => {
      popupEvent = event;
      report("popup " + JSON.stringify(event));
      resolve(event);
    });
  });

  const opened = await invoke("open", { label: "docs", url: remote + "/", bounds: { x: 40, y: 40, width: 600, height: 420 } });
  report("open " + JSON.stringify(opened));

  let title = "";
  for (let i = 0; i < 60 && title !== "Remote Title"; i++) {
    const state = await invoke("state", { label: "docs" });
    if (state && state.title) title = state.title;
    if (title !== "Remote Title") await new Promise((r) => setTimeout(r, 100));
  }
  report("state " + title);

  const shot1 = await invoke("capture", { label: "docs" });
  report("shot first " + shot1.width + "x" + shot1.height + " " + shot1.png.length);
  const first = await window.crust.invoke("window", "capture", { label: "main" });
  report("capture first " + first.png.length);
  const moved = await invoke("setBounds", { label: "docs", bounds: { x: 120, y: 300, width: 340, height: 200 } });
  report("bounds " + JSON.stringify(moved));
  await new Promise((r) => setTimeout(r, 300));
  const shot2 = await invoke("capture", { label: "docs" });
  report("shot second " + shot2.width + "x" + shot2.height + " " + shot2.png.length);
  const second = await window.crust.invoke("window", "capture", { label: "main" });
  report("capture second " + second.png.length);

  const refused = await invoke("open", { label: "evil", url: "https://not-allowed.test/", bounds: { x: 0, y: 0, width: 100, height: 100 } });
  report("refused " + JSON.stringify(refused));

  let capture = "";
  for (let i = 0; i < 60 && !capture.startsWith("capture "); i++) {
    const state = await invoke("state", { label: "docs" });
    if (state && state.title && state.title !== "Remote Title") capture = state.title;
    if (!capture.startsWith("capture ")) await new Promise((r) => setTimeout(r, 100));
  }
  report("capture-denied " + JSON.stringify(capture));

  await Promise.race([popupSeen, new Promise((r) => setTimeout(r, 6000))]);
  report("popup-seen " + JSON.stringify(popupEvent));
  const windows = await window.crust.invoke("window", "list");
  report("windows " + windows.labels.length);
  const closed = await invoke("close", { label: "docs" });
  report("close " + JSON.stringify(closed));
  report("done");
})();
</script></body></html>`;
}
