#include <Foundation/Foundation.h>

void *foundation_string_class(void) {
  return (void *)[NSString class];
}

int foundation_roundtrip(const char *s) {
  NSString *ns = [NSString stringWithUTF8String:s];
  return (int)[ns length];
}