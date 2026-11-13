#if !OBJC_OLD_DISPATCH_PROTOTYPES
extern void *objc_msgSend(void *, void *, ...);
#endif
extern void *objc_getClass(const char *);
extern void *sel_registerName(const char *);
extern void *objc_msgSend;

// full end-to-end: alloc/init, then send description and class
void *nsstring_from_cstr(const char *s);

void *probe_e2e(void) {
  void *cls = (void *)objc_getClass("NSObject");
  void *selAlloc = (void *)sel_registerName("alloc");
  void *selInit = (void *)sel_registerName("init");
  void *selDesc = (void *)sel_registerName("description");
  void *selClass = (void *)sel_registerName("class");
  void *instance = objc_msgSend(cls, selAlloc);
  instance = objc_msgSend(instance, selInit);
  void *desc = objc_msgSend(instance, selDesc);
  void *klass = objc_msgSend(instance, selClass);
  return desc;
}

void *probe_class_only(void) {
  void *cls = (void *)objc_getClass("NSObject");
  void *selClass = (void *)sel_registerName("class");
  return objc_msgSend(cls, selClass);
}

long probe_utf8_length(void *nsstring) {
  void *cls = (void *)objc_getClass("NSString");
  void *selUTF8 = (void *)sel_registerName("UTF8String");
  const char *p = (const char *)objc_msgSend(nsstring, selUTF8);
  if (!p) return -1;
  long n = 0;
  while (p[n]) n++;
  return n;
}

// returns 1 when the two strings are equal (no Foundation comparison call)
int probe_utf8_equals(void *nsstring, const char *cstr) {
  void *selUTF8 = (void *)sel_registerName("UTF8String");
  const char *p = (const char *)objc_msgSend(nsstring, selUTF8);
  if (!p) return 0;
  int i = 0;
  while (p[i] && cstr[i]) { if (p[i] != cstr[i]) return 0; i++; }
  return p[i] == cstr[i];
}