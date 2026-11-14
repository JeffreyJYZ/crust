static void nf_cat(char *dst, long cap, const char *src) {
	long i = 0;
	if (cap <= 0) return;
	while (dst[i] && i < cap - 1) i++;
	if (!src) {
		dst[i] = 0;
		return;
	}
	while (*src && i < cap - 1) dst[i++] = *src++;
	dst[i] = 0;
}

static void nf_set(char *dst, long cap, const char *src) {
	if (cap <= 0) return;
	dst[0] = 0;
	nf_cat(dst, cap, src);
}

static long nf_strlen(const char *s) {
	long n = 0;
	if (!s) return 0;
	while (s[n]) n++;
	return n;
}

static obj_t nf_sel(const char *name) { return sel_registerName(name); }

// class_getInstanceMethod walks the superclass chain, so this answers "could an
// instance of this class answer this selector" without ever sending it.
static int nf_has_instance(const char *cls, const char *selname) {
	void *c = objc_getClass(cls);
	if (!c) return 0;
	return class_getInstanceMethod(c, nf_sel(selname)) != 0;
}

// [obj respondsToSelector:sel] — the honest existence test for a class object.
static int nf_responds(obj_t obj, const char *selname) {
	if (!obj) return 0;
	obj_t s = nf_sel("respondsToSelector:");
	obj_t candidate = nf_sel(selname);
	if (!s || !candidate) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(obj, s, candidate);
}

// One NSString, built and consumed on this side. Encoding 4 is
// NSUTF8StringEncoding, and -initWithBytes:length:encoding: is the measured
// constructor: +stringWithUTF8String: aborts Bun outright.
static obj_t nf_nsstring(const char *s) {
	if (!s) s = "";
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        nf_sel("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, nf_sel("initWithBytes:length:encoding:"), s, (unsigned long)nf_strlen(s), 4LL);
}

