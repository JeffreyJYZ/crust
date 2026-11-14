// --- bundle identity -------------------------------------------------------

// -[NSBundle bundleIdentifier] is nil in an unbundled process, and that is the
// exact condition under which +[UNUserNotificationCenter currentNotificationCenter]
// raises. The check is the guard, so the dangerous send is never reached.
static int nf_has_bundle_id(void) {
	obj_t cls = objc_getClass("NSBundle");
	if (!cls) return 0;
	if (!nf_responds(cls, "mainBundle")) return 0;
	obj_t bundle = ((obj_t (*)(void *, void *))objc_msgSend)(cls, nf_sel("mainBundle"));
	if (!bundle) return 0;
	if (!nf_has_instance("NSBundle", "bundleIdentifier")) return 0;
	obj_t ident = ((obj_t (*)(void *, void *))objc_msgSend)(bundle, nf_sel("bundleIdentifier"));
	if (!ident) return 0;
	unsigned long long length = ((unsigned long long (*)(void *, void *))objc_msgSend)(
	    ident, nf_sel("length"));
	return length > 0;
}

