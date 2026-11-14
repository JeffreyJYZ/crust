// crust macOS status-bar unit — compiled at launch by bun:ffi's cc().
// Its own translation unit so `plugins/tray` is real without growing shim.c, obeying the same measured rules (research/cc.md, research/objc.md, `site/app/docs/design/page.mdx`): every objc_msgSend site casts to a FIXED prototype, since the varargs form delivers wrong values with no diagnostic and only zero-argument sends survive; no framework headers, so every symbol is a hand-written extern over void *; nothing crosses the boundary but an opaque `NSStatusItem *` as a number, ints and `const char *` from static storage (a title arrives as an encoded buffer plus its length); and no NSString is built from a short C literal that leaves C, because a short ASCII NSString is a tagged pointer and cannot survive bun:ffi's number round-trip.
// Menu clicks are a runtime class whose IMP is the JavaScript JSCallback passed to tray_create: `class_addMethod` links and runs (measured; `objc_addMethod` does not exist on this system), the IMP delivers (id self, SEL _cmd, id sender), and the sender's `tag` is read back through tray_item_index. Every selector is preflighted with class_getInstanceMethod / respondsToSelector: before it is sent, because an uncaught Objective-C exception is a SIGABRT with no JavaScript error, so an absent selector is reported as a 0 return instead.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *class_getClassMethod(void *cls, void *sel);
extern const char *class_getName(void *cls);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *name, void *imp, const char *types);

