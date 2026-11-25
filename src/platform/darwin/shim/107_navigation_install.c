// --- navigation: install and uninstall ---------------------------------------
// Split from 107_navigation.c at the line cap. Concatenated into the same translation unit, so
// nav_class, nav_has, nav_key and NAV_RETAIN come from that part; an install is the only caller.

// 0 installed, 1 no webview or a missing selector, 3 the delegate class could not be built,
// 4 already installed (the association answered), 5 this webview already has a navigation
// delegate that is not ours — refusing beats clobbering a page's own.
int crust_nav_install(void *web) {
	if (!web) return 1;
	if (!nav_has(web, "setNavigationDelegate:")) return 1;
	if (objc_getAssociatedObject(web, &nav_key)) return 4;
	if (!nav_has(web, "navigationDelegate")) return 1;
	void *current = ((void *(*)(void *, void *))objc_msgSend)(web,
	                                                          sel_registerName("navigationDelegate"));
	if (current) return 5;

	void *cls = nav_class();
	if (!cls) return 3;
	void *delegate = ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	if (!delegate) return 3;
	// The association is set before the delegate, so the object outlives the unretained
	// -setNavigationDelegate: send.
	objc_setAssociatedObject(web, &nav_key, delegate, NAV_RETAIN);
	((void (*)(void *, void *, void *))objc_msgSend)(web,
	                                                 sel_registerName("setNavigationDelegate:"),
	                                                 delegate);
	return 0;
}

// 1 when a delegate this unit installed was removed, 0 when there was none.
int crust_nav_uninstall(void *web) {
	if (!web) return 0;
	void *delegate = objc_getAssociatedObject(web, &nav_key);
	if (!delegate) return 0;
	if (nav_has(web, "setNavigationDelegate:"))
		((void (*)(void *, void *, void *))objc_msgSend)(web,
		                                                 sel_registerName("setNavigationDelegate:"),
		                                                 0);
	objc_setAssociatedObject(web, &nav_key, 0, NAV_RETAIN);
	// The association's RETAIN is one owner; `[cls new]` at install was a second, +1 owner that
	// clearing the association does not touch. Without this release every surface cycle leaks a
	// CrustNavigationDelegate.
	((void (*)(void *, void *))objc_msgSend)(delegate, sel_registerName("release"));
	return 1;
}
