// --- navigation policy: the committed-navigation decision ------------------
// Third part of the navigation unit, concatenated between 107_navigation.c (the delegate class and
// its helpers) and 109_navigation_state.c (the readbacks). The event callbacks only OBSERVE a load;
// `browser.origins` must also be able to REFUSE one after the surface exists — a redirect or a
// scripted `location =` never passes through `browser.open`'s entry check.
//
// The URL arrives as bytes in a bounded C buffer: an NSString cannot cross bun:ffi. The decision
// itself is one int from a JSCallback, and the WebKit decisionHandler is a block whose invoke
// pointer is called here, because a block cannot cross either. No object or struct crosses.

#define NAV_ACTION_TEXT 2048

static char nav_action_url[NAV_ACTION_TEXT];
static int (*nav_policy_sink)(void *web) = 0;

// The first four words of a block: the invoke pointer takes the block and one WKNavigationActionPolicy.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, long long);
} nav_decision_t;

// WKNavigationActionPolicyCancel is 0, Allow is 1. With no sink (an app window, not a browser
// surface) the decision is allow, so installing this method changes no existing navigation.
static void nav_decide_policy(void *self, void *cmd, void *web, void *action, void *handler) {
	(void)self;
	(void)cmd;
	nav_action_url[0] = 0;
	if (action && nav_has(action, "request")) {
		void *request = ((void *(*)(void *, void *))objc_msgSend)(action,
		                                                         sel_registerName("request"));
		if (request && nav_has(request, "URL")) {
			void *url = ((void *(*)(void *, void *))objc_msgSend)(request, sel_registerName("URL"));
			if (url && nav_has(url, "absoluteString")) {
				void *text = ((void *(*)(void *, void *))objc_msgSend)(
				    url, sel_registerName("absoluteString"));
				nav_copy(text, nav_action_url, NAV_ACTION_TEXT);
			}
		}
	}
	int allow = nav_policy_sink ? nav_policy_sink(web) : 1;
	if (!handler) return;
	nav_decision_t *block = (nav_decision_t *)handler;
	if (!block->invoke) return;
	block->invoke(handler, allow ? 1LL : 0LL);
}

void crust_nav_set_decision_sink(void *sink) { nav_policy_sink = (int (*)(void *))sink; }

/** The URL of the action currently being decided; its full length, even when the buffer was short. */
long long crust_nav_decision_url(char *dst, long long cap) {
	if (!dst || cap <= 0) return -1;
	long long length = 0;
	while (nav_action_url[length]) length++;
	long long copied = length < cap - 1 ? length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = nav_action_url[i];
	dst[copied] = 0;
	return length;
}
