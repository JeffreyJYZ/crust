// (c) no objc headers at all: take function pointers as void* params
typedef void *(*msgsend_fn)(void *self, void *sel, ...);
typedef void *(*getclass_fn)(const char *name);
typedef void *(*selreg_fn)(const char *name);

void *call_description(void *msgsend, void *getclass, void *selreg) {
  msgsend_fn send = (msgsend_fn)msgsend;
  getclass_fn gc = (getclass_fn)getclass;
  selreg_fn sr = (selreg_fn)selreg;
  void *cls = (void *)gc("NSObject");
  void *sel = (void *)sr("description");
  return send(cls, sel);
}