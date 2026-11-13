#ifdef CRUST_EXTRA
int with_extra(void) { return 1; }
#else
int with_extra(void) { return 0; }
#endif
int always(int x) { return x + 1; }