// --- QuickLook preview: the data source and its items -----------------------
// Second part, after `125_preview.c`'s prelude and file list. Both classes are runtime-built
// (`objc_allocateClassPair` plus `class_addMethod`, the device the navigation delegate and the
// download delegate already use), because a preview item has to answer `-previewItemURL` with a
// file URL built from bytes this side holds. Nothing is allocated per show: the item objects are
// made per ask and left to the autorelease pool the pump drains.

static pv_t preview_ds_class;
static pv_t preview_item_class;
static long preview_slot_offset = -1;
static pv_t preview_source_object;

static int preview_item_slot(pv_t self) {
	if (preview_slot_offset < 0) return -1;
	return *(int *)((char *)self + preview_slot_offset);
}

static pv_t preview_item_new(int index) {
	if (!preview_item_class) return 0;
	pv_t allocated = pv_msg0(preview_item_class, "alloc");
	if (!allocated) return 0;
	pv_t item = pv_msg0(allocated, "init");
	if (!item) return 0;
	if (preview_slot_offset >= 0) *(int *)((char *)item + preview_slot_offset) = index;
	// The runtime retains what it keeps; the pool the pump drains owns the rest.
	pv_msg0(item, "autorelease");
	return item;
}

// `-numberOfPreviewItemsInPreviewPanel:` — one row per path, so arrow keys walk the list.
static long long preview_items_imp(pv_t self, void *cmd, pv_t panel) {
	(void)self;
	(void)cmd;
	(void)panel;
	return (long long)preview_paths_used;
}

// `-previewPanel:previewItemAtIndex:` — a fresh item per ask, holding only its slot.
static pv_t preview_item_imp(pv_t self, void *cmd, pv_t panel, long long index) {
	(void)self;
	(void)cmd;
	(void)panel;
	if (index < 0 || index >= preview_paths_used) return 0;
	return preview_item_new((int)index);
}

// `-previewItemURL`, the only method the QLPreviewItem protocol requires.
static pv_t preview_url_imp(pv_t self, void *cmd) {
	(void)cmd;
	int slot = preview_item_slot(self);
	if (slot < 0) return 0;
	return pv_file_url(preview_paths[slot]);
}

// Both classes once per process. A name already registered means a previous unit in this process
// built them, so it is reused rather than re-created (`objc_allocateClassPair` answers nil then).
static void preview_classes_init(void) {
	if (preview_ds_class && preview_item_class) return;
	pv_t base = objc_getClass("NSObject");
	if (!base) return;

	preview_ds_class = objc_getClass("CrustPreviewDataSource");
	if (!preview_ds_class) {
		pv_t cls = objc_allocateClassPair(base, "CrustPreviewDataSource", 0);
		if (cls) {
			class_addMethod(cls, sel_registerName("numberOfPreviewItemsInPreviewPanel:"),
			                (pv_imp)preview_items_imp, "q@:@");
			class_addMethod(cls, sel_registerName("previewPanel:previewItemAtIndex:"),
			                (pv_imp)preview_item_imp, "@@:q");
			objc_registerClassPair(cls);
			preview_ds_class = cls;
		}
	}

	preview_item_class = objc_getClass("CrustPreviewItem");
	if (!preview_item_class) {
		pv_t cls = objc_allocateClassPair(base, "CrustPreviewItem", 0);
		if (cls) {
			// Alignment 2 is log2(sizeof(int)); the slot is read as a plain int off the ivar
			// offset, so no object crosses and nothing is retained twice.
			class_addIvar(cls, "slot", sizeof(int), 2, "i");
			class_addMethod(cls, sel_registerName("previewItemURL"), (pv_imp)preview_url_imp,
			                "@@:");
			objc_registerClassPair(cls);
			preview_item_class = cls;
		}
	}
	if (preview_item_class && preview_slot_offset < 0) {
		void *ivar = class_getInstanceVariable(preview_item_class, "slot");
		if (ivar) preview_slot_offset = (long)ivar_getOffset(ivar);
	}
}

// The one instance the panel's `-setDataSource:` is given: that setter is unretained, so this holds
// it for the process, exactly as the download delegate keeps its own.
static pv_t preview_source(void) {
	preview_classes_init();
	if (!preview_source_object && preview_ds_class) {
		pv_t allocated = pv_msg0(preview_ds_class, "alloc");
		if (allocated) preview_source_object = pv_msg0(allocated, "init");
	}
	return preview_source_object;
}
