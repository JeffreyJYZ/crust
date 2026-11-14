// --- the fallback: NSUserNotificationCenter --------------------------------

// Records which selector is absent, so a status 2 names it instead of guessing.
// `as_class` 1 tests `[Class respondsToSelector:]`, 0 tests the instance chain.
static int nf_absent(const char *cls, const char *selname, int as_class) {
	int present = as_class ? nf_responds((obj_t)objc_getClass(cls), selname)
	                       : nf_has_instance(cls, selname);
	if (present) return 0;
	nf_cat(nf_reason, NF_REASON_BYTES, cls);
	nf_cat(nf_reason, NF_REASON_BYTES, as_class ? " +" : " -");
	nf_cat(nf_reason, NF_REASON_BYTES, selname);
	nf_cat(nf_reason, NF_REASON_BYTES, " is absent");
	return 1;
}

// Deprecated since macOS 11, and on macOS 27 the class is a husk: measured,
// NSUserNotification answers -init but has no -setTitle:, -setInformativeText: or
// -setBody:, so nothing with content can be built and this path reports a missing
// symbol rather than delivering an empty notification. There is no authorization
// call and no delivery report either: -deliverNotification: returns void, so
// "accepted with no exception" is the strongest fact it can give.
static int nf_post_deprecated(const char *title, const char *body) {
	obj_t center_cls = objc_getClass("NSUserNotificationCenter");
	obj_t note_cls = objc_getClass("NSUserNotification");

	if (!center_cls || !note_cls) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "neither UNUserNotificationCenter nor NSUserNotificationCenter can be used here");
		return NF_MISSING;
	}
	if (nf_absent("NSUserNotificationCenter", "defaultUserNotificationCenter", 1)) return NF_MISSING;
	if (nf_absent("NSUserNotificationCenter", "deliverNotification:", 0)) return NF_MISSING;
	if (nf_absent("NSUserNotification", "alloc", 1)) return NF_MISSING;
	if (nf_absent("NSUserNotification", "init", 0)) return NF_MISSING;
	if (nf_absent("NSUserNotification", "setTitle:", 0)) return NF_MISSING;

	obj_t center = ((obj_t (*)(void *, void *))objc_msgSend)(center_cls,
	                                                        nf_sel("defaultUserNotificationCenter"));
	if (!center) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "NSUserNotificationCenter: +defaultUserNotificationCenter returned nil");
		return NF_ERROR;
	}

	obj_t note = ((obj_t (*)(void *, void *))objc_msgSend)(note_cls, nf_sel("alloc"));
	note = note ? ((obj_t (*)(void *, void *))objc_msgSend)(note, nf_sel("init")) : 0;
	if (!note) {
		nf_cat(nf_reason, NF_REASON_BYTES, "NSUserNotificationCenter: NSUserNotification could not be built");
		return NF_ERROR;
	}

	obj_t title_text = nf_nsstring(title);
	if (!title_text) {
		nf_cat(nf_reason, NF_REASON_BYTES, "NSUserNotificationCenter: the title NSString could not be built");
		return NF_ERROR;
	}
	((void (*)(void *, void *, obj_t))objc_msgSend)(note, nf_sel("setTitle:"), title_text);
	if (nf_strlen(body) > 0 && nf_has_instance("NSUserNotification", "setInformativeText:")) {
		obj_t body_text = nf_nsstring(body);
		if (body_text)
			((void (*)(void *, void *, obj_t))objc_msgSend)(note, nf_sel("setInformativeText:"), body_text);
	}

	nf_center = 2;
	((void (*)(void *, void *, obj_t))objc_msgSend)(center, nf_sel("deliverNotification:"), note);
	nf_cat(nf_reason, NF_REASON_BYTES,
	       "NSUserNotificationCenter accepted the notification; that API has no authorization call "
	       "and no delivery report, so acceptance is all it can state");
	return NF_DELIVERED;
}

