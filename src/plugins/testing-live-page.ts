/**
 * The page for the live webview proof: a button, a React-style tracked input, a console line, and
 * two counters posted back to the harness. rAF frames are a visibility signal — WebKit stops them
 * for a page it considers hidden — while the `setInterval` heartbeat keeps ticking (throttled)
 * and is the liveness signal. Only the frame/heartbeat routes are test scaffolding.
 */
export const LIVE_PAGE = `<!doctype html>
<html><body>
<button id="go" onclick="document.getElementById('out').textContent='clicked'">go</button>
<input id="name" />
<div id="state"></div>
<div id="out">idle</div>
<script>
	window.__state = "";
	var frames = 0;
	(function tick(){ frames++; if (frames % 10 === 0) try { fetch('/frames?n=' + frames); } catch(e){} requestAnimationFrame(tick); })();
	var beats = 0;
	setInterval(function(){ beats++; try { fetch('/heartbeat?n=' + beats + '&v=' + document.visibilityState); } catch(e){} }, 250);
	var input = document.getElementById("name");
	var state = document.getElementById("state");
	var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
	var tracked = input.value;
	Object.defineProperty(input, "value", {
		configurable: true,
		get: function () { return proto.get.call(this); },
		set: function (value) { tracked = String(value); proto.set.call(this, value); }
	});
	input.addEventListener("input", function () {
		var value = proto.get.call(input);
		if (value === tracked) return;
		tracked = value;
		window.__state = value;
		state.textContent = value;
	});
	console.log("page ready");
</script>
</body></html>`;
