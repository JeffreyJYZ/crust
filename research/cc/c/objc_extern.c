// (a) hand-declared extern variadic objc_msgSend
extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);

void *call_description(void) {
  void *cls = (void *)objc_getClass("NSObject");
  void *sel = (void *)sel_registerName("description");
  return objc_msgSend(cls, sel);
}

void *call_class(void) {
  void *cls = (void *)objc_getClass("NSObject");
  void *sel = (void *)sel_registerName("class");
  return objc_msgSend(cls, sel);
}