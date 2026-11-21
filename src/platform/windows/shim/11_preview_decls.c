// --- the preview-host entry points, as pointers -----------------------------
// A fourth table beside `11_pointer_core.c` and `11_win32_style.c`, on the same rule: these are
// reached by one plugin and by nothing else, so a machine missing one refuses `preview` by name
// instead of the whole launch. `54_preview.c` binds them on first use and says which failed.
//
// **Every return here is `int`.** `AssocQueryStringW`, `CLSIDFromString`, `CoCreateInstance`,
// `SHCreateStreamOnFileEx` and `SHCreateItemFromParsingName` all answer a 32-bit HRESULT, and a
// `shim_i64` declaration reads an undefined top half of RAX — the trap `CoInitializeEx` already paid
// for (see `abi-width.test.ts`). `shim_preview_hresult` is the one place a failure is widened, so a
// sign test in JavaScript survives the trip.
//
// `SHCreateStreamOnFileEx` and `SHCreateItemFromParsingName` return an HRESULT *and* an object through
// their last parameter; neither returns the object. Reading the return as a handle would compare an
// HRESULT against zero and pass on failure.

static int (*CoCreateInstance)(const void *clsid, void *outer, unsigned int context,
                               const void *iid, void **out);
static int (*CLSIDFromString)(const shim_wchar *text, void *clsid);
static int (*AssocQueryStringW)(unsigned int flags, unsigned int kind, const shim_wchar *assoc,
                                const shim_wchar *extra, shim_wchar *out, unsigned int *length);
static int (*SHCreateStreamOnFileEx)(const shim_wchar *path, unsigned int mode, unsigned int attributes,
                                     int create, void *template_stream, void **stream);
static int (*SHCreateItemFromParsingName)(const shim_wchar *path, void *context, const void *iid,
                                          void **item);
