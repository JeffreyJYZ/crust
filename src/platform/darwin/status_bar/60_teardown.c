// Remove the item from the menu bar. The runtime class and its target stay
// alive for the process: a later status bar reuses the same click IMP, and a
// freed trampoline behind a live object is a SIGABRT.
void tray_destroy(obj_t item) {
	if (!item) return;
	tray_building_menu = 0;
	obj_t bar_cls = objc_getClass("NSStatusBar");
	if (!bar_cls || !tray_responds(bar_cls, "systemStatusBar")) return;
	if (!tray_has_instance("NSStatusBar", "removeStatusItem:")) return;
	obj_t bar = ((obj_t (*)(void *, void *))objc_msgSend)(bar_cls,
	                                                     sel_registerName("systemStatusBar"));
	if (!bar) return;
	((void (*)(void *, void *, obj_t))objc_msgSend)(bar, sel_registerName("removeStatusItem:"),
	                                                item);
}
