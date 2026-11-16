// --- network: a WKURLSchemeHandler built at runtime, part two ---------------
// The byte serving, joined into ONE translation unit with `110_network.c` by
// platform/darwin/network.ts, so it uses that part's `net_fail`, `net_nsstring` and statics.
// An allowed task is answered from a buffer JavaScript fills in the same call, never fetched:
// WebKit's scheme handler has no pass-through, and `+[NSData dataWithContentsOfURL:]` answers nil
// for a scheme it does not know (measured 2026-11-16: crust-net -> nil, https -> 577 bytes), so a
// fetch can never serve a `crust-net:` request. The body is refused, not truncated, when the rule
// that allowed it carries more bytes than the buffer holds.

// The body and content type a rule may serve. Mirrored by NETWORK_BODY_LIMIT in network-types.ts.
#define NET_BODY 262144
#define NET_MIME 128

static char net_body[NET_BODY];
static char net_mime[NET_MIME];
static long long net_served_bytes;
static int net_task_count;

// A byte count as an NSString, for the Content-Length header. No stdio in this unit.
static obj_t net_number(long long value) {
	char digits[24];
	char text[24];
	int at = 0;
	int k = 0;
	long long n = value;
	if (n == 0) digits[at++] = '0';
	while (n > 0) {
		digits[at++] = (char)('0' + (n % 10));
		n /= 10;
	}
	while (at > 0) text[k++] = digits[--at];
	return net_nsstring(text, k);
}

// Fill the two buffers from the rule that allowed this request, then answer the task in three
// sends. 0 means the answer could not be built; the caller fails the task with a real NSError.
// The response is an NSHTTPURLResponse, not an NSURLResponse: only the HTTP one carries headers, and
// without `Access-Control-Allow-Origin` a page on the bridge's `http://127.0.0.1:<port>` origin can
// never read a `crust-net:` body — its `fetch` is cross-origin. The MIME type has to arrive the same
// way, because WebKit refuses to execute a `<script src>` whose Content-Type is not JavaScript.
static int net_serve(obj_t task, obj_t url) {
	obj_t data, response, mime, headers, version;
	long long length;
	long mime_len;
	length = net_fill ? (long long)((long (*)(char *, int, char *, int))net_fill)(
	                        net_body, NET_BODY, net_mime, NET_MIME)
	                  : -1;
	if (length < 0) return 0;
	if (length > NET_BODY - 1) length = NET_BODY - 1;
	net_mime[NET_MIME - 1] = 0;
	// `alloc`/`initWithBytes:` and not `+dataWithBytes:`: the convenience constructor autoreleases,
	// so a body handed to WebKit could be freed by the next pool drain before the content process
	// consumed it — which reads as a served request that renders nothing (measured 2026-11-16).
	data = ((obj_t (*)(void *, void *, char *, unsigned long))objc_msgSend)(
	    ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSData"), sel_registerName("alloc")),
	    sel_registerName("initWithBytes:length:"), net_body, (unsigned long)length);
	if (!data) return 0;
	mime_len = net_len(net_mime);
	mime = net_nsstring(net_mime, mime_len);
	version = net_nsstring("HTTP/1.1", 8);
	if (!mime || !version) return 0;
	headers = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSMutableDictionary"),
	                                                    sel_registerName("dictionary"));
	if (!headers) return 0;
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    headers, sel_registerName("setObject:forKey:"), mime, net_nsstring("Content-Type", 12));
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    headers, sel_registerName("setObject:forKey:"), net_number(length),
	    net_nsstring("Content-Length", 14));
	// Required, measured: a page on the bridge's `http://127.0.0.1:<port>` origin reads a
	// `crust-net:` body through `fetch` with this header and fails `TypeError: Load failed` without
	// it, so the scheme is cross-origin to the page and WebKit does enforce CORS here.
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    headers, sel_registerName("setObject:forKey:"), net_nsstring("*", 1),
	    net_nsstring("Access-Control-Allow-Origin", 27));
	response = ((obj_t (*)(void *, void *, obj_t, long long, obj_t, obj_t))objc_msgSend)(
	    ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSHTTPURLResponse"),
	                                              sel_registerName("alloc")),
	    sel_registerName("initWithURL:statusCode:HTTPVersion:headerFields:"), url, 200LL, version,
	    headers);
	if (!response) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(task, sel_registerName("didReceiveResponse:"),
	                                                response);
	((void (*)(void *, void *, obj_t))objc_msgSend)(task, sel_registerName("didReceiveData:"), data);
	((void (*)(void *, void *))objc_msgSend)(task, sel_registerName("didFinish"));
	net_served_bytes += length;
	net_task_count++;
	return 1;
}

long long net_served(void) { return net_served_bytes; }

int net_tasks(void) { return net_task_count; }
