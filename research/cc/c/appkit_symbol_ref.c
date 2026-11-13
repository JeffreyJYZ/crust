extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);

// A symbol that only exists if AppKit is actually linked.
extern id NSApp;

void *get_nsapp(void) { return (void *)NSApp; }

int nsapp_is_nonnull(void) { return NSApp != 0; }

// NSString lives in Foundation
void *foundation_string_class(void) { return (void *)objc_getClass("NSString"); }