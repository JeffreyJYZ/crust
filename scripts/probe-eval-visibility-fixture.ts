/** Window states and page fixture for `probe-eval-visibility.ts`. */

export interface Variant {
	name: string;
	x: number;
	y: number;
	alpha: number;
	ordered: boolean;
	occlusion: boolean;
	forceVisible?: boolean;
}

export const VARIANTS: Variant[] = [
	{
		name: "A offscreen a=1 order+join (live test)",
		x: -4000,
		y: -4000,
		alpha: 1,
		ordered: true,
		occlusion: true,
	},
	{
		name: "B offscreen a=0 order+join",
		x: -4000,
		y: -4000,
		alpha: 0,
		ordered: true,
		occlusion: true,
	},
	{ name: "C onscreen a=0 order+join", x: 220, y: 220, alpha: 0, ordered: true, occlusion: true },
	{
		name: "D onscreen a=0 order+join, no occl selector",
		x: 220,
		y: 220,
		alpha: 0,
		ordered: true,
		occlusion: false,
	},
	{
		name: "E onscreen a=0 order+join + occlusion-flag forced",
		x: 220,
		y: 220,
		alpha: 0,
		ordered: true,
		occlusion: true,
		forceVisible: true,
	},
	{
		name: "F offscreen a=1 order+join + occlusion-flag forced",
		x: -4000,
		y: -4000,
		alpha: 1,
		ordered: true,
		occlusion: true,
		forceVisible: true,
	},
	{
		name: "G never ordered (hide())",
		x: -4000,
		y: -4000,
		alpha: 0,
		ordered: false,
		occlusion: true,
	},
];

/** A beat every 100 ms carries the page's own clock, so delivery lag can be measured, not guessed. */
export const PAGE = `<!doctype html><html><body><button id="go">go</button><div id="out">idle</div><script>
var beat = 0, frames = 0;
setInterval(function(){ beat++; try { fetch('/beat?b=' + beat + '&t=' + performance.now() + '&v=' + document.visibilityState); } catch(e){} }, 100);
(function tick(){ frames++; window.__frames = frames; requestAnimationFrame(tick); })();
document.getElementById('go').onclick = function(){ document.getElementById('out').textContent = 'clicked'; };
</script></body></html>`;
