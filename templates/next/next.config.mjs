/**
 * A crust app is one binary that serves static files and nothing else, so the
 * Next side has to be a finished static export before it is embedded.
 *
 * @type {import("next").NextConfig}
 */
const config = {
	output: "export",
	images: { unoptimized: true },
};

export default config;
