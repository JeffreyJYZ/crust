#include <objc/message.h>

// modern arm64 SDK: objc_msgSend is only declared as void(void) unless
// OBJC_OLD_DISPATCH_PROTOTYPES is set, so use the typed prototype instead.
void *send_description(void *self, void *sel) {
  return ((void *(*)(void *, void *))objc_msgSend)(self, sel);
}