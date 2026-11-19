/**
 * The project this proof writes into its scratch directory: one window, its opening size, and the
 * config `crust build` compiles into the bundle.
 */

/** `CFBundleExecutable` that `crust build` pins. Same constant as the other e2e scripts. */
export const BINARY_NAME = "crust-app";

/** `app.name` in the generated config; also the bundle's name. */
export const APP_NAME = "Fullscreen crust";

/** The one window's label. The page asks for fullscreen on it and the probe finds it by number. */
export const LABEL = "main";

/**
 * The window opens at a size no display could mistake for fullscreen, so `covers display` has a real
 * difference to measure rather than a window that was already the size of the screen.
 */
export const OPENING = { width: 800, height: 600 };

export const CONFIG_SOURCE = `import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.e2e-fullscreen", name: ${JSON.stringify(APP_NAME)}, version: "0.1.0" },
	windows: [
		{ label: ${JSON.stringify(LABEL)}, url: "/", width: ${OPENING.width}, height: ${OPENING.height}, title: ${JSON.stringify(APP_NAME)} },
	],
} satisfies CrustConfig;
`;
