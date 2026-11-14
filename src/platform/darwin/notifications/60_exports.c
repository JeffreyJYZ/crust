// --- exports ---------------------------------------------------------------

// Post one notification. Status 0 delivered, 1 authorization pending or denied,
// 2 symbol missing, 3 API error. `title` and `body` are NUL-terminated byte
// buffers, never objects; `body` may be "" and must never be null from JS.
int crust_notification_post(const char *title, const char *body, int auth_wait_ms) {
	int status;
	nf_reason[0] = 0;
	nf_skip[0] = 0;
	nf_center = 0;

	if (!title || !title[0]) {
		nf_set(nf_reason, NF_REASON_BYTES, "a notification needs a non-empty title");
		return NF_ERROR;
	}
	if (!body) body = "";

	status = nf_post_modern(title, body, auth_wait_ms);
	if (status < 0) status = nf_post_deprecated(title, body);

	// Say why the real API was skipped, once, ahead of the answering path.
	if (nf_skip[0]) {
		char combined[NF_REASON_BYTES];
		combined[0] = 0;
		nf_cat(combined, NF_REASON_BYTES, "UNUserNotificationCenter was not used: ");
		nf_cat(combined, NF_REASON_BYTES, nf_skip);
		nf_cat(combined, NF_REASON_BYTES, ". ");
		nf_cat(combined, NF_REASON_BYTES, nf_reason);
		nf_set(nf_reason, NF_REASON_BYTES, combined);
	}
	if (!nf_reason[0]) nf_set(nf_reason, NF_REASON_BYTES, "no reason was recorded");
	return status;
}

// Why the last post ended as it did. Static storage, valid until the next call.
const char *crust_notification_reason(void) { return nf_reason; }

// Which center answered the last post: 0 none, 1 UNUserNotificationCenter,
// 2 the deprecated NSUserNotificationCenter.
int crust_notification_center(void) { return nf_center; }
