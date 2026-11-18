// --- downloads: the exports bun:ffi binds -----------------------------------
// Nothing here holds an object across the boundary: a token is a number, a path is a C string, and
// the two directions of one sink call are dl_text (in) and dl_answer (out).

int dl_abi(void) {
	return objc_getClass("NSObject") && objc_getClass("WKDownload") ? 1 : 0;
}

const char *dl_text_copy(void) { return dl_text; }

long long dl_last_token_get(void) { return dl_last_token; }

// The destination JavaScript chose, read by the delegate right after the sink returns.
void dl_answer(const char *bytes, long len) {
	long i = 0;
	while (i < len && i < DL_PATH - 1) {
		dl_destination[i] = bytes[i];
		i++;
	}
	dl_destination[i] = 0;
	dl_destination_len = i;
}

// One runtime class per process, and one delegate instance: -setDelegate: is unretained, so the
// instance has to outlive every download, which is what static storage gives it.
int dl_install(void *sink) {
	obj_t super, allocated, cls;
	if (!sink) return 0;
	dl_sink = sink;
	if (dl_delegate) return 1;
	if (!dl_delegate_class) {
		super = objc_getClass("NSObject");
		if (!super || !objc_getClass("WKDownload")) return 0;
		cls = objc_allocateClassPair(super, "CrustDownloadDelegate", 0);
		if (!cls) return 0;
		// A half-built class must be disposed before returning: the cache stays empty so a retry can
		// build it again, instead of being wedged forever by the first failed selector
		// (native-surface.md §5, measured 2026-11-18).
		if (!class_addMethod(cls,
		                     sel_registerName("download:decideDestinationUsingResponse:"
		                                      "suggestedFilename:completionHandler:"),
		                     (void *)dl_decide, "v@:@@@@")) {
			objc_disposeClassPair(cls);
			return 0;
		}
		if (!class_addMethod(cls, sel_registerName("download:didFinishToURL:"),
		                     (void *)dl_finished, "v@:@@")) {
			objc_disposeClassPair(cls);
			return 0;
		}
		if (!class_addMethod(cls, sel_registerName("download:didFailWithError:"),
		                     (void *)dl_failed, "v@:@@")) {
			objc_disposeClassPair(cls);
			return 0;
		}
		objc_registerClassPair(cls);
		dl_delegate_class = cls;
	}
	allocated = ((obj_t (*)(void *, void *))objc_msgSend)(dl_delegate_class,
	                                                      sel_registerName("alloc"));
	if (!allocated) return 0;
	dl_delegate = ((obj_t (*)(void *, void *))objc_msgSend)(allocated, sel_registerName("init"));
	return dl_delegate != 0;
}

// A token > 0 for the caller to hold, 0 when any step refused; the request never leaves C.
long long dl_start(obj_t web, const char *bytes, long len) {
	obj_t text, url, request, block;
	long long token;
	if (!web || !dl_delegate || dl_started_count >= DL_SLOTS) return 0;
	text = dl_nsstring(bytes, len);
	if (!text) return 0;
	url = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(objc_getClass("NSURL"),
	                                                       sel_registerName("URLWithString:"), text);
	// NSURL copied the string; balance the +1 from dl_nsstring on every path, including a nil URL.
	dl_release(text);
	if (!url) return 0;
	request = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(objc_getClass("NSURLRequest"),
	                                                          sel_registerName("requestWithURL:"),
	                                                          url);
	if (!request) return 0;
	token = ++dl_next_token;
	block = dl_start_block_for(token);
	if (!block) return 0;
	dl_started_count++;
	((void (*)(void *, void *, obj_t, void *))objc_msgSend)(
	    web, sel_registerName("startDownloadUsingRequest:completionHandler:"), request, block);
	return token;
}

int dl_cancel(long long token) {
	long slot = dl_slot(token);
	obj_t download;
	if (slot < 0) return 0;
	download = dl_downloads[slot];
	dl_downloads[slot] = 0;
	dl_tokens[slot] = 0;
	((void (*)(void *, void *, void *))objc_msgSend)(download, sel_registerName("cancel:"),
	                                                 &dl_cancel_block);
	return 1;
}

void dl_forget(long long token) {
	long slot = dl_slot(token);
	if (slot < 0) return;
	dl_downloads[slot] = 0;
	dl_tokens[slot] = 0;
}

double dl_progress(long long token) {
	long slot = dl_slot(token);
	obj_t progress;
	if (slot < 0) return -1.0;
	progress = ((obj_t (*)(void *, void *))objc_msgSend)(dl_downloads[slot],
	                                                     sel_registerName("progress"));
	if (!progress) return -1.0;
	return ((double (*)(void *, void *))objc_msgSend)(progress,
	                                                  sel_registerName("fractionCompleted"));
}
