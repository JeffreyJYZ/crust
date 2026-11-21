// --- QuickLook preview: proof hooks -----------------------------------------
// Fourth part, last. Test-only reads that ask the dynamic classes the exact questions
// `QLPreviewPanel` asks, so the suite proves the data source, the item objects and the C-side path
// array without ever making a panel key or taking the screen.

// The number the panel itself would see.
int shim_preview_probe_count(void) {
	pv_t source = preview_source();
	if (!source) return -1;
	return (int)(long long)((long long (*)(void *, void *, pv_t))objc_msgSend)(
	    source, sel_registerName("numberOfPreviewItemsInPreviewPanel:"), 0);
}

// The file path the item at `index` answers for `-previewItemURL`, copied into static storage.
const char *shim_preview_probe_item_url(int index) {
	static char buffer[SHIM_PREVIEW_PATH_BYTES];
	buffer[0] = 0;
	pv_t source = preview_source();
	if (!source) return buffer;
	pv_t item = ((pv_t (*)(void *, void *, pv_t, long long))objc_msgSend)(
	    source, sel_registerName("previewPanel:previewItemAtIndex:"), 0, (long long)index);
	if (!item) return buffer;
	pv_t url = pv_msg0(item, "previewItemURL");
	if (!url) return buffer;
	pv_t path = pv_msg0(url, "path");
	if (!path) return buffer;
	const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(
	    path, sel_registerName("UTF8String"));
	if (!utf8) return buffer;
	long i = 0;
	while (utf8[i] && i < SHIM_PREVIEW_PATH_BYTES - 1) {
		buffer[i] = utf8[i];
		i++;
	}
	buffer[i] = 0;
	return buffer;
}
