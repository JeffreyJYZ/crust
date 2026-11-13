// probe12: does -framework actually link anything? use a symbol that ONLY exists in a framework.
extern void *objc_getClass(const char *name);
void *foundation_class(void) { return (void *)objc_getClass("NSString"); }

// A Foundation *function* (not a class lookup) to force a real link:
extern const char *NSHomeDirectory(void);
const char *use_nshomedir(void) { return NSHomeDirectory(); }