// what include path does tcc use by default? find out from the compiler's own errors
extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern const char *NSHomeDirectory(void);

int description_len(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *sa = (void *)sel_registerName("alloc");
  void *o = objc_msgSend(c, sa);
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
  int n = 0;
  while (p[n]) n++;
  return n;
}

int homedir_first_byte(void) {
  const char *h = NSHomeDirectory();
  if (!h) return -1;
  return (int)(unsigned char)h[0];
}

int homedir_len(void) {
  const char *h = NSHomeDirectory();
  if (!h) return -1;
  int n = 0;
  while (h[n]) n++;
  return n;
}