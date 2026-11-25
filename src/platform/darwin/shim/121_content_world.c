// --- the content world the credential lives in -----------------------------
// `+[WKContentWorld worldWithName:]` (macOS 11+) returns a JavaScript world whose globals the page
// cannot read, enumerate or patch, while the *document* it runs against is the page's own — DOM
// nodes and DOM events are shared, JS expanse is not. That asymmetry is the whole mechanism here:
// a script in this world reads the bridge token, keeps it in a closure, and answers the page over
// DOM events, so page script can call every granted command and still cannot read the token or
// replace the transport.
//
// One world per process, created on first ask: `worldWithName:` answers the same world for the
// same name, and a second distinct world would give a page two bridges with two different tokens.
static obj_t content_world = 0;

// One assignment point, so the +1 we own is balanced whenever the cache is replaced. Retain before
// releasing the old value: storing the same world twice is a no-op, never a dangling pointer.
static obj_t content_world_store(obj_t world) {
	obj_t previous = content_world;
	crust_retain(world);
	content_world = world;
	crust_release(previous);
	return content_world;
}

obj_t shim_content_world(void) {
	obj_t name, world;
	if (content_world) return content_world;
	if (!objc_getClass("WKContentWorld")) return 0;
	name = ((obj_t (*)(void *, void *, const char *, unsigned long,
	                   long long))objc_msgSend)(
	    ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                              sel_registerName("alloc")),
	    sel_registerName("initWithBytes:length:encoding:"), "crust", (unsigned long)5, 4LL);
	if (!name) return 0;
	crust_own(name);
	world = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    objc_getClass("WKContentWorld"), sel_registerName("worldWithName:"), name);
	crust_release(name);
	if (!world) return 0;
	// A convenience factory is +0/autoreleased and the pump drains a pool every tick (50_app.c),
	// so the cached pointer needs one owning retain. The audit wrapper counts it; the store
	// balances any replacement through the same wrapper.
	return content_world_store(world);
}

// `world` must never be nil: `-initWithSource:…inContentWorld:` dereferences it and faults with no
// Objective-C exception, so this resolves a named world from a small integer instead of taking a
// pointer — 0 is `+[WKContentWorld pageWorld]`, 1 is the process's isolated world. Measured
// 2026-11-17: a nil world segfaults at 0x10 from a plain `cc()` call.
obj_t shim_content_world_named(int which) {
	if (which == 0) {
		if (!objc_getClass("WKContentWorld")) return 0;
		return ((obj_t (*)(void *, void *))objc_msgSend)(
		    objc_getClass("WKContentWorld"), sel_registerName("pageWorld"));
	}
	return shim_content_world();
}

// Add one `WKUserScript` to a webview's user content controller, running at document start in
// `world` (a `shim_content_world_named` result). WebKit copies the controller's script list when the
// webview is created, so this must run before the URL is loaded — `window-create.ts` does exactly
// that, and the load is the last step there.
// Returns 1 when the script was added, 0 when any step refused.
int shim_webview_add_user_script(obj_t web, obj_t world, const char *source, int main_frame_only) {
	obj_t config, controller, text, script;
	if (!web || !source) return 0;
	config = ((obj_t (*)(void *, void *))objc_msgSend)(web, sel_registerName("configuration"));
	if (!config) return 0;
	controller = ((obj_t (*)(void *, void *))objc_msgSend)(
	    config, sel_registerName("userContentController"));
	if (!controller) return 0;

	text = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                 sel_registerName("alloc"));
	if (!text) return 0;
	text = ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    text, sel_registerName("initWithBytes:length:encoding:"), source,
	    (unsigned long)shim_cstr_len(source), 4LL);
	if (!text) return 0;
	crust_own(text);

	// `injectionTime` 0 is `WKUserScriptInjectionTimeAtDocumentStart`. The initializer is
	// `initWithSource:injectionTime:forMainFrameOnly:inContentWorld:` (macOS 11+); the older
	// four-argument overload has no world and would put the token back in the page.
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("WKUserScript"),
	                                                         sel_registerName("alloc"));
	if (!allocd) {
		crust_release(text);
		return 0;
	}
	script = ((obj_t (*)(void *, void *, obj_t, long long, int, obj_t))objc_msgSend)(
	    allocd, sel_registerName("initWithSource:injectionTime:forMainFrameOnly:inContentWorld:"),
	    text, 0LL, main_frame_only ? 1 : 0, world);
	if (!script) {
		crust_release(text);
		return 0;
	}
	crust_own(script);

	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    controller, sel_registerName("addUserScript:"), script);
	// The controller copies the script and the script copied the source, so both +1 objects end
	// here. Two scripts are added per window; these go through the audit wrappers too.
	crust_release(script);
	crust_release(text);
	return 1;
}
