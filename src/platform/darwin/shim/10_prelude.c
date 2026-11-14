// crust macOS shim — compiled at launch by bun:ffi's cc().
//
// Ported from spike/shim.c, which is measured working. Rules this file obeys,
// each one measured (research/cc.md, research/objc.md, DESIGN.md §2):
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and runs, and
//     delivers wrong argument values with no diagnostic (41 arrived as
//     1806466472). Zero-argument sends happen to survive; nothing else does.
//  2. No framework headers. <AppKit/AppKit.h> and <Foundation/Foundation.h> are
//     unreachable from TinyCC with or without -I/-F, so every symbol is a
//     hand-written extern over void *.
//  3. No struct crosses the export boundary. CGRect is only ever built and read
//     inside this file; JS sees scalars and pointers.
//  4. Nothing here builds an NSString from a short string. A short ASCII
//     NSString is a tagged pointer that cannot survive bun:ffi's number
//     round-trip, and `+[NSString stringWithUTF8String:]` aborts Bun outright.
//     Strings stay in C: the URL chain in shim_webview_load uses
//     -initWithBytes:length:encoding: on an alloc'd NSString.
//
// Deliberately absent, each a measured crash or a dead path: the title, the
// string intern table, and every NSString helper that returned an object across
// the boundary (shim_string, shim_nsstring_from_data, shim_data).

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *object_getClass(void *obj);
extern const char *class_getName(void *cls);
extern int NSApplicationLoad(void);
extern int CFRunLoopRunInMode(void *mode, double seconds, int returnAfterSourceHandled);
extern void *CFRunLoopGetMain(void);
extern void *CFRunLoopGetCurrent(void);
extern obj_t __CFStringMakeConstantString(const char *cstr);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);

// --- runtime handles -------------------------------------------------------

obj_t shim_cls(const char *name) { return objc_getClass(name); }
obj_t shim_sel(const char *name) { return sel_registerName(name); }

obj_t shim_object_class(obj_t obj) { return object_getClass(obj); }

// Class name of an object's class, or of a class object itself.
const char *shim_class_name(obj_t obj) {
	void *c = object_getClass(obj);
	if (!c) return "(null)";
	const char *n = class_getName(c);
	return n ? n : "(null)";
}

const char *shim_name_of_class(void *cls) {
	const char *n = class_getName(cls);
	return n ? n : "(null)";
}

void *shim_instance_method(void *cls, obj_t sel) { return class_getInstanceMethod(cls, sel); }

// [obj respondsToSelector:sel] — the only existence test that is safe on an
// instance, and the honest one on a class object.
int shim_responds(obj_t obj, obj_t candidate) {
	obj_t s = sel_registerName("respondsToSelector:");
	if (!s) return 0;
	return (int)((char (*)(void *, void *, void *))objc_msgSend)(obj, s, candidate);
}

