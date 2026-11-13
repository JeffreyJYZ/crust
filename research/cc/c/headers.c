#include <stdlib.h>
#include <string.h>

int use_headers(int n) {
  char *p = (char *)malloc((size_t)n);
  if (!p) return -1;
  memset(p, 'x', (size_t)n);
  p[n - 1] = 0;
  int v = (int)strlen(p);
  free(p);
  return v + n;
}