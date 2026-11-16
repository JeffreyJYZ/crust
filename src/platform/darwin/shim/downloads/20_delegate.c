// --- downloads: the delegate's IMPs -----------------------------------------
// Three methods, and the two block invokes. Every one of them reads its values in C and reports
// through the sink as a token plus a kind, so JavaScript never receives an Objective-C object and
// reads what it needs from dl_text afterwards.

// download:decideDestinationUsingResponse:suggestedFilename:completionHandler:
static void dl_decide(void *self, void *cmd, obj_t download, obj_t response, obj_t suggested,
                      obj_t completion) {
	long slot = dl_slot_of(download);
	(void)self;
	(void)cmd;
	(void)response;
	dl_last_token = slot >= 0 ? dl_tokens[slot] : -1;
	dl_destination_len = 0;
	dl_copy(dl_text, DL_TEXT, dl_utf8(suggested));
	if (dl_sink && dl_last_token > 0) ((void (*)(long long, int))dl_sink)(dl_last_token, DL_ASK);
	// No destination means no download: a nil URL is WebKit's own cancel.
	dl_call_block(completion, dl_destination_len > 0 ? dl_file_url(dl_destination, dl_destination_len) : 0);
}

static void dl_finished(void *self, void *cmd, obj_t download, obj_t url) {
	long slot = dl_slot_of(download);
	obj_t path;
	(void)self;
	(void)cmd;
	if (slot < 0) return;
	dl_last_token = dl_tokens[slot];
	path = ((obj_t (*)(void *, void *))objc_msgSend)(url, sel_registerName("path"));
	dl_copy(dl_text, DL_TEXT, dl_utf8(path));
	if (dl_sink) ((void (*)(long long, int))dl_sink)(dl_last_token, DL_FINISHED);
}

static void dl_failed(void *self, void *cmd, obj_t download, obj_t error) {
	long slot = dl_slot_of(download);
	obj_t text;
	(void)self;
	(void)cmd;
	if (slot < 0) return;
	dl_last_token = dl_tokens[slot];
	text = ((obj_t (*)(void *, void *))objc_msgSend)(error, sel_registerName("localizedDescription"));
	dl_copy(dl_text, DL_TEXT, dl_utf8(text));
	if (dl_sink) ((void (*)(long long, int))dl_sink)(dl_last_token, DL_FAILED);
}

// The completion of -startDownloadUsingRequest:completionHandler:, whose only argument is the
// download WebKit created — nil when it refused the request.
static void dl_start_done(void *block, obj_t download) {
	long slot;
	int i;
	(void)block;
	if (!download) return;
	slot = dl_free_slot();
	if (slot < 0) return;
	((void (*)(void *, void *, obj_t))objc_msgSend)(download, sel_registerName("setDelegate:"),
	                                                dl_delegate);
	dl_downloads[slot] = download;
	// Starts are queued before the send, so the oldest pending token is this download's.
	dl_tokens[slot] = dl_pending_count > 0 ? dl_pending[0] : -1;
	for (i = 1; i < dl_pending_count; i++) dl_pending[i - 1] = dl_pending[i];
	if (dl_pending_count > 0) dl_pending_count--;
}

static void dl_cancel_done(void *block, obj_t resume) {
	(void)block;
	(void)resume;
}
