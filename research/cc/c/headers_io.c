#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int headers_io(void) {
  char *p = (char *)malloc(32);
  snprintf(p, 32, "%d", 42);
  int v = atoi(p);
  free(p);
  return v;
}