#include <stdio.h>
#include <string.h>
#include <stdlib.h>
int hdr_all(void) {
  char *p = (char *)malloc(64);
  snprintf(p, 64, "%s-%d", "x", 7);
  size_t n = strlen(p);
  free(p);
  return (int)n;
}