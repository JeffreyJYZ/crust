#include <objc/message.h>

void *call_description(void) {
  void *cls = (void *)objc_getClass("NSObject");
  void *sel = (void *)sel_registerName("description");
  return objc_msgSend(cls, sel);
}