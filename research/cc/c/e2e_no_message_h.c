typedef void *(*msgsend2_fn)(void *, void *);
extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);

int objc_strlen(const char *s) { int n = 0; while (s[n]) n++; return n; }

const char *describe_new_object(void) {
  void *NSObject = (void *)objc_getClass("NSObject");
  void *selAlloc = (void *)sel_registerName("alloc");
  void *selInit = (void *)sel_registerName("init");
  void *selDesc = (void *)sel_registerName("description");
  void *selUTF8 = (void *)sel_registerName("UTF8String");
  void *obj = objc_msgSend(NSObject, selAlloc);
  if (!obj) return 0;
  obj = objc_msgSend(obj, selInit);
  if (!obj) return 0;
  void *desc = objc_msgSend(obj, selDesc);
  if (!desc) return 0;
  return (const char *)objc_msgSend(desc, selUTF8);
}

int class_returns_self(void) {
  void *NSObject = (void *)objc_getClass("NSObject");
  void *selClass = (void *)sel_registerName("class");
  return objc_msgSend(NSObject, selClass) == NSObject;
}

int string_roundtrip_length(const char *cstr) {
  void *NSString = (void *)objc_getClass("NSString");
  void *selWith = (void *)sel_registerName("stringWithUTF8String:");
  void *selUTF8 = (void *)sel_registerName("UTF8String");
  void *s = objc_msgSend(NSString, selWith, cstr);
  if (!s) return -1;
  const char *back = (const char *)objc_msgSend(s, selUTF8);
  return back ? objc_strlen(back) : -2;
}

void *roundtrip_pointer(void) {
  void *NSObject = (void *)objc_getClass("NSObject");
  void *selAlloc = (void *)sel_registerName("alloc");
  return objc_msgSend(NSObject, selAlloc);
}