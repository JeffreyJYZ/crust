// --- the modern path: UNUserNotificationCenter -----------------------------
//
// Returns -1 when it cannot run at all (and says why in nf_skip), otherwise a
// status. A -1 must fall through to the deprecated center; anything else is the
// answer, because falling back after a denial would ask twice.
static int nf_post_modern(const char *title, const char *body, int auth_wait_ms) {
	obj_t cls = objc_getClass("UNUserNotificationCenter");
	obj_t content_cls = objc_getClass("UNMutableNotificationContent");
	obj_t request_cls = objc_getClass("UNNotificationRequest");

	if (!cls || !content_cls || !request_cls) {
		nf_set(nf_skip, NF_SKIP_BYTES, "the UserNotifications framework is not linked");
		return -1;
	}
	if (!nf_has_bundle_id()) {
		nf_set(nf_skip, NF_SKIP_BYTES,
		       "an unbundled process has no bundle identifier, which "
		       "+[UNUserNotificationCenter currentNotificationCenter] aborts on");
		return -1;
	}
	if (!nf_responds(cls, "currentNotificationCenter")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "+[UNUserNotificationCenter currentNotificationCenter] is absent");
		return -1;
	}
	if (!nf_has_instance("UNUserNotificationCenter", "requestAuthorizationWithOptions:completionHandler:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "-requestAuthorizationWithOptions:completionHandler: is absent");
		return -1;
	}
	if (!nf_has_instance("UNUserNotificationCenter", "addNotificationRequest:withCompletionHandler:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "-addNotificationRequest:withCompletionHandler: is absent");
		return -1;
	}
	if (!nf_responds(request_cls, "requestWithIdentifier:content:trigger:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "+[UNNotificationRequest requestWithIdentifier:content:trigger:] is absent");
		return -1;
	}
	if (!nf_has_instance("UNMutableNotificationContent", "setTitle:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "-[UNMutableNotificationContent setTitle:] is absent");
		return -1;
	}
	if (!nf_blocks_init()) {
		nf_set(nf_skip, NF_SKIP_BYTES,
		       "the __NSGlobalBlock__ class is absent, so a completion handler cannot be built");
		return -1;
	}

	obj_t center = ((obj_t (*)(void *, void *))objc_msgSend)(cls, nf_sel("currentNotificationCenter"));
	if (!center) {
		nf_set(nf_skip, NF_SKIP_BYTES, "+currentNotificationCenter returned nil");
		return -1;
	}
	nf_center = 1;

	// Authorization is requested explicitly, before anything is queued.
	// Options 6 is alert | sound.
	nf_auth_done = 0;
	nf_auth_granted = 0;
	((void (*)(void *, void *, unsigned long long, void *))objc_msgSend)(
	    center, nf_sel("requestAuthorizationWithOptions:completionHandler:"),
	    (unsigned long long)6, (void *)&nf_auth_block);
	// The caller owns this wait: a first post triggers the system permission prompt, and
	// 1500 ms — what this used to allow — is shorter than a person takes to read a dialog.
	// Clamped, because a negative or absurd value would stall an invoke for no reason.
	nf_wait(&nf_auth_done, auth_wait_ms < 0 ? 0 : auth_wait_ms > 120000 ? 120000 : auth_wait_ms);
	if (!nf_auth_done) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "UNUserNotificationCenter: authorization was requested and the OS has not answered "
		       "yet, so nothing is confirmed as delivered");
		return NF_AUTH;
	}
	if (!nf_auth_granted) {
		char line[NF_REASON_BYTES];
		line[0] = 0;
		nf_cat(line, NF_REASON_BYTES, "UNUserNotificationCenter: authorization was denied");
		if (nf_error_code != 0 || nf_error_text[0]) {
			// The OS's own words, not ours: `UNErrorDomain` says the system refused the app,
			// `com.apple.usernotifications` says the user did, and the two need opposite
			// responses — register or sign, versus ask again later.
			char detail[NF_REASON_BYTES];
			detail[0] = 0;
			nf_cat(detail, sizeof detail, " (code ");
			char digits[16];
			int value = nf_error_code;
			int at = 0;
			if (value == 0) {
				digits[at++] = '0';
			} else {
				if (value < 0) {
					digits[at++] = '-';
					value = -value;
				}
				char reversed[12];
				int count = 0;
				while (value > 0 && count < 11) {
					reversed[count++] = (char)('0' + (value % 10));
					value /= 10;
				}
				while (count > 0) digits[at++] = reversed[--count];
			}
			digits[at] = 0;
			nf_cat(detail, sizeof detail, digits);
			if (nf_error_text[0]) {
				nf_cat(detail, sizeof detail, ": ");
				nf_cat(detail, sizeof detail, nf_error_text);
			}
			nf_cat(detail, sizeof detail, ")");
			nf_cat(line, NF_REASON_BYTES, detail);
			// Measured on 2026-11-14, and the signature is not a cause. Two things refuse this,
			// each isolated by holding the other constant with a fresh identifier and ad-hoc
			// signing: a bundle running from the system temp directory (identical bundle in
			// `/var/folders/…T` answered code 1 while the copy in `~/dev` delivered, twice each
			// way), and a bundle identifier macOS already recorded as denied, which is never
			// re-asked no matter what signs it — the original probe id answered code 1 ad-hoc,
			// under an Apple Development certificate, via LaunchServices and from ~/Applications.
			if (nf_error_code == 1 && nf_same(nf_error_domain, "UNErrorDomain")) {
				nf_cat(line, NF_REASON_BYTES,
				       ". macOS refuses this authorization in two measured cases: the .app runs "
				       "from the system temp directory (a copy under /var/folders answered code 1 "
				       "while the identical bundle in ~/dev delivered), or this bundle identifier "
				       "was recorded as denied earlier and is never asked again. The signature is "
				       "not the cause. Run the app from a normal directory, and change app.id in "
				       "crust.config.ts if this identifier was refused before");
			}
		}
		nf_set(nf_reason, NF_REASON_BYTES, line);
		return NF_AUTH;
	}

	obj_t content = ((obj_t (*)(void *, void *))objc_msgSend)(content_cls, nf_sel("alloc"));
	content = content ? ((obj_t (*)(void *, void *))objc_msgSend)(content, nf_sel("init")) : 0;
	if (!content) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: UNMutableNotificationContent could not be built");
		return NF_ERROR;
	}
	obj_t title_text = nf_nsstring(title);
	if (!title_text) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: the title NSString could not be built");
		return NF_ERROR;
	}
	if (nf_has_instance("UNMutableNotificationContent", "setTitle:"))
		((void (*)(void *, void *, obj_t))objc_msgSend)(content, nf_sel("setTitle:"), title_text);
	if (nf_strlen(body) > 0 && nf_has_instance("UNMutableNotificationContent", "setBody:")) {
		obj_t body_text = nf_nsstring(body);
		if (body_text)
			((void (*)(void *, void *, obj_t))objc_msgSend)(content, nf_sel("setBody:"), body_text);
	}

	obj_t identifier = nf_identifier();
	if (!identifier) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: the request identifier could not be built");
		return NF_ERROR;
	}
	// A nil trigger delivers immediately.
	obj_t request = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    request_cls, nf_sel("requestWithIdentifier:content:trigger:"), identifier, content, (obj_t)0);
	if (!request) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: +requestWithIdentifier:content:trigger: returned nil");
		return NF_ERROR;
	}

	nf_job_done = 0;
	nf_job_failed = 0;
	((void (*)(void *, void *, obj_t, void *))objc_msgSend)(
	    center, nf_sel("addNotificationRequest:withCompletionHandler:"), request,
	    (void *)&nf_job_block);
	nf_wait(&nf_job_done, NF_DELIVER_WAIT_MS);
	if (!nf_job_done) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "UNUserNotificationCenter: the request was handed over and the OS has not answered "
		       "yet, so delivery is unconfirmed");
		return NF_AUTH;
	}
	if (nf_job_failed) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "UNUserNotificationCenter: -addNotificationRequest:withCompletionHandler: reported an error");
		return NF_ERROR;
	}
	nf_cat(nf_reason, NF_REASON_BYTES,
	       "UNUserNotificationCenter scheduled the request and its completion handler reported no "
	       "error (the OS offers no \"the user saw it\" signal)");
	return NF_DELIVERED;
}

