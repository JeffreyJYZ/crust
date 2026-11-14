// crust macOS status-bar unit — compiled at launch by bun:ffi's cc().
//
// This is the tray half of the AppKit surface, kept in its own translation unit
// so `plugins/tray` can be real without growing shim.c. It obeys the same rules
// as shim.c, each measured (research/cc.md, research/objc.md, DESIGN.md §2):
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and runs and
//     delivers wrong argument values with no diagnostic; only zero-argument
//     sends survive it.
//  2. No framework headers. <AppKit/AppKit.h> and <Foundation/Foundation.h> are
//     unreachable from TinyCC with or without -I/-F, so every symbol here is a
//     hand-written extern over void *.
//  3. No object and no struct crosses the export boundary. JS gets an opaque
//     `NSStatusItem *` as a number, ints, and `const char *` out of static
//     storage; a title arrives as an encoded buffer plus its byte length and
//     never as a JS string.
//  4. Nothing here builds an NSString from a short C literal that then leaves
//     C. Titles are built with -initWithBytes:length:encoding: and consumed on
//     this side: a short ASCII NSString is a tagged pointer and cannot survive
//     bun:ffi's number round-trip.
//  5. Menu clicks are a runtime class whose IMP is the JavaScript JSCallback
//     passed to tray_create. `class_addMethod` links and runs (measured); the
//     IMP delivers (id self, SEL _cmd, id sender), and the sender's `tag` is
//     read back through tray_item_index so JS learns which row was clicked.
//     `objc_addMethod` does not exist on this system, `class_addMethod` does.
//
// Every selector is preflighted with class_getInstanceMethod / respondsToSelector:
// before it is sent. An uncaught Objective-C exception is a SIGABRT with no
// JavaScript error, so an absent selector is reported as a 0 return instead.

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

