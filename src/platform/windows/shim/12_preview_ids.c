// --- the preview host: which handler, which interface -----------------------
// GUIDs as bytes, in the in-memory layout COM reads: Data1/Data2/Data3 little-endian, Data4 in
// printed order. `CLSID` and `IID` are both 16 bytes with no header here, so one `unsigned char[16]`
// is either of them, and a COM call takes its address.
//
// Values read from the Windows SDK's own `ShObjIdl_core.idl` (IPreviewHandler, IInitializeWithItem)
// and `Propsys.idl` (IInitializeWithFile, IInitializeWithStream), not from memory: a wrong IID is a
// QueryInterface that answers E_NOINTERFACE and a preview that never renders. `preview-ids.test.ts`
// decodes these bytes back into the printed GUID and fails if they drift.

static const unsigned char SHIM_IID_PREVIEW[16] = {
    0xc6, 0xb1, 0x95, 0x88, 0x1f, 0xb4, 0x1c, 0x4c,
    0xa5, 0x62, 0x0d, 0x56, 0x42, 0x50, 0x83, 0x6f,
};
static const unsigned char SHIM_IID_INIT_FILE[16] = {
    0x66, 0x45, 0xd1, 0xb7, 0x09, 0x05, 0xce, 0x4c,
    0xa7, 0x1f, 0x0a, 0x55, 0x42, 0x33, 0xbd, 0x9b,
};
static const unsigned char SHIM_IID_INIT_STREAM[16] = {
    0x9d, 0xb4, 0x24, 0xb8, 0xac, 0x22, 0x61, 0x41,
    0xac, 0x8a, 0x99, 0x16, 0xe8, 0xfa, 0x3f, 0x7f,
};
static const unsigned char SHIM_IID_INIT_ITEM[16] = {
    0x3f, 0xbe, 0x73, 0x7f, 0x79, 0xfb, 0x3c, 0x49,
    0xa6, 0xc7, 0x7e, 0xe1, 0x4e, 0x24, 0x58, 0x41,
};
static const unsigned char SHIM_IID_SHELL_ITEM[16] = {
    0x1e, 0x6d, 0x82, 0x43, 0x18, 0xe7, 0xee, 0x42,
    0xbc, 0x55, 0xa1, 0xe2, 0x61, 0xc3, 0x7b, 0xfe,
};

// The shell-extension category a preview handler is registered under. It is the same GUID as
// `IID_IPreviewHandler`, and `AssocQueryStringW` writes this handler's CLSID as text.
static const shim_wchar SHIM_PREVIEW_CATEGORY[] = {
    '{', '8', '8', '9', '5', 'b', '1', 'c', '6', '-', 'b', '4', '1', 'f', '-',
    '4', 'c', '1', 'c', '-', 'a', '5', '6', '2', '-', '0', 'd', '5', '6', '4',
    '2', '5', '0', '8', '3', '6', 'f', '}', 0,
};
