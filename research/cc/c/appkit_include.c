#include <AppKit/AppKit.h>
void *appkit_nsapp_class(void) { return (void *)NSApp; }
void *appkit_string_class(void) { return (void *)[NSString class]; }