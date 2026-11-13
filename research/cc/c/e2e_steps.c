// split: e2e steps without the NSApp symbol (proves objc works end to end)
extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);

int objc_strlen(const char *s) { int n = 0; while (s[n]) n++; return n; }

int step_class(void) { return objc_getClass("NSObject") != 0; }
int step_sel(void) { return sel_registerName("description") != 0; }

int step_alloc(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *s = (void *)sel_registerName("alloc");
  return objc_msgSend(c, s) != 0;
}

int step_init(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *s = (void *)sel_registerName("alloc");
  void *o = objc_msgSend(c, s);
  if (!o) return 0;
  void *si = (void *)sel_registerName("init");
  void *r = objc_msgSend(o, si);
  return r != 0;
}

int step_description_returns_ptr(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *sAlloc = (void *)sel_registerName("alloc");
  void *o = objc_msgSend(c, sAlloc);
  if (!o) return 0;
  void *si = (void *)sel_registerName("init");
  o = objc_msgSend(o, si);
  if (!o) return 0;
  void *sd = (void *)sel_registerName("description");
  void *d = objc_msgSend(o, sd);
  return d != 0;
}

int step_utf8_nonnull(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *sAlloc = (void *)sel_registerName("alloc");
  void *o = objc_msgSend(c, sAlloc);
  if (!o) return 0;
  void *si = (void *)sel_registerName("init");
  o = objc_msgSend(o, si);
  if (!o) return 0;
  void *sd = (void *)sel_registerName("description");
  void *d = objc_msgSend(o, sd);
  if (!d) return 0;
  void *su = (void *)sel_registerName("UTF8String");
  const char *p = (const char *)objc_msgSend(d, su);
  return p != 0;
}

int step_utf8_first_byte(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *sAlloc = (void *)sel_registerName("alloc");
  void *o = objc_msgSend(c, sAlloc);
  if (!o) return -1;
  void *si = (void *)sel_registerName("init");
  o = objc_msgSend(o, si);
  if (!o) return -2;
  void *sd = (void *)sel_registerName("description");
  void *d = objc_msgSend(o, sd);
  if (!d) return -3;
  void *su = (void *)sel_registerName("UTF8String");
  const char *p = (const char *)objc_msgSend(d, su);
  if (!p) return -4;
  return (int)(unsigned char)p[0];
}

int step_utf8_strlen_via_c(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *sAlloc = (void *)sel_registerName("alloc");
  void *o = objc_msgSend(c, sAlloc);
  if (!o) return -1;
  void *si = (void *)sel_registerName("init");
  o = objc_msgSend(o, si);
  if (!o) return -2;
  void *sd = (void *)sel_registerName("description");
  void *d = objc_msgSend(o, sd);
  if (!d) return -3;
  void *su = (void *)sel_registerName("UTF8String");
  const char *p = (const char *)objc_msgSend(d, su);
  if (!p) return -4;
  return objc_strlen(p);
}

int string_roundtrip_length(void *cstr) {
  void *NSString = (void *)objc_getClass("NSString");
  void *selWith = (void *)sel_registerName("stringWithUTF8String:");
  void *selUTF8 = (void *)sel_registerName("UTF8String");
  void *s = objc_msgSend(NSString, selWith, cstr);
  if (!s) return -1;
  const char *back = (const char *)objc_msgSend(s, selUTF8);
  return back ? objc_strlen(back) : -2;
}

int string_class_nonnull(void) { return objc_getClass("NSString") != 0; }