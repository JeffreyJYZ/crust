// --- GTK init and the pump -------------------------------------------------
// Bun's main thread owns the loop, so there is no gtk_main(): GTK is initialised
// once, then one main-context iteration runs per timer tick. This is the same
// shape as the darwin NSRunLoop slice.

static int (*shim_init_check)(int *, char ***);
static int (*shim_context_iterate)(void *, int);

int shim_pump_resolve(void) {
	void *h = shim_gtk_handle();
	return shim_sym(h, "gtk_init_check", (void **)&shim_init_check) &&
	       shim_sym(h, "g_main_context_iteration", (void **)&shim_context_iterate);
}

int shim_gtk_init(void) {
	if (!shim_init_check) return 0;
	// NULL argc/argv: crust takes no GTK command line, and passing our own would
	// let GTK eat flags the runtime owns.
	return shim_init_check(0, 0) ? 1 : 0;
}

// One slice: g_main_context_iteration(NULL, FALSE) never blocks, because a
// blocking iterate would stop the timer that called it.
int shim_pump(void) {
	if (!shim_context_iterate) return 0;
	return shim_context_iterate(0, 0) ? 1 : 0;
}
