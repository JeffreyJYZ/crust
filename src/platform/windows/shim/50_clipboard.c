// --- clipboard -------------------------------------------------------------
// The Win32 pasteboard: OpenClipboard, GetClipboardData(CF_UNICODETEXT), SetClipboardData. Text is
// the whole of what this shim carries — PNG needs CF_DIBV5 plus a GDI+ encode, which is a second
// library and a second format, so `clipboard.readImage`/`writeImage` refuse by name in the adapter
// rather than answering empty bytes that read as "the clipboard holds no image".
//
// The open/close pair is closed on every return path including the failures: an abandoned
// OpenClipboard blocks the entire session from copying, which is worse than the refusal it would be
// reporting. `shim_clipboard_read` copies into a caller-sized buffer and reports the length the
// whole string needs, so a long copy is re-read at its exact size instead of being truncated.

#define SHIM_CF_UNICODETEXT 13u
#define SHIM_GMEM_MOVEABLE 0x0002u
// 64 KiB of UTF-16 is far past any real copy and still bounds the NUL scan below.
#define SHIM_CLIPBOARD_CHARS 0x10000

// UTF-16 in, UTF-8 out: the byte length the whole string needs, or -1. Defined here rather than in
// the prelude because the prelude is at the line cap; `52_osinfo.c` calls it too, and both parts
// compile after this one, which is why `shim-source.ts`'s order is load-bearing.
static int shim_utf8(const shim_wchar *src, int srclen, char *dst, int cap) {
	if (!src || srclen < 0) return -1;
	if (!shim_win32_load() || !WideCharToMultiByte) return -1;
	int need = WideCharToMultiByte(65001u, 0u, src, srclen, 0, 0, 0, 0);
	if (need <= 0) return 0;
	if (dst && cap > 0) {
		// Leave room for the terminator: bun:ffi reads this buffer as a cstring.
		int take = need < cap - 1 ? need : cap - 1;
		if (take > 0) WideCharToMultiByte(65001u, 0u, src, srclen, dst, take, 0, 0);
		dst[take] = 0;
	}
	return need;
}

// The clipboard's text as UTF-8 into a caller buffer: the full byte length, 0 for no text, -1 when
// the clipboard could not be opened (another process holds it, which is a real state).
int shim_clipboard_read(char *dst, int cap) {
	if (!shim_win32_load() || !OpenClipboard) return -1;
	if (!OpenClipboard(0)) return -1;
	int result = -1;
	shim_h block = GetClipboardData(SHIM_CF_UNICODETEXT);
	if (!block) {
		// No CF_UNICODETEXT on the clipboard is empty text, not a broken clipboard.
		result = 0;
	} else {
		const shim_wchar *text = (const shim_wchar *)GlobalLock(block);
		if (!text) {
			result = 0;
		} else {
			int chars = 0;
			while (chars < SHIM_CLIPBOARD_CHARS && text[chars]) chars++;
			result = shim_utf8(text, chars, dst, cap);
			GlobalUnlock(block);
		}
	}
	CloseClipboard();
	return result;
}

// 1 written, 0 refused, -1 the clipboard could not be opened. The block comes from
// GlobalAlloc(GMEM_MOVEABLE) because SetClipboardData takes ownership of a movable block and frees
// it itself — a GlobalFree after a successful set would be a double free, so the free only runs when
// the set did not happen.
int shim_clipboard_write(const char *bytes, int length) {
	if (!bytes || length < 0) return 0;
	if (!shim_win32_load()) return -1;
	// UTF-8 is never shorter than UTF-16 in code units, so `length + 1` wchars always fits the
	// conversion and the terminator — no second pass and no fixed stack buffer to overrun.
	shim_h block = GlobalAlloc(SHIM_GMEM_MOVEABLE, (unsigned long long)(length + 1) * 2);
	if (!block) return 0;
	shim_wchar *wide = (shim_wchar *)GlobalLock(block);
	if (!wide) {
		GlobalFree(block);
		return 0;
	}
	int chars = shim_utf16(bytes, wide, length + 1);
	GlobalUnlock(block);
	if (chars < 0) {
		GlobalFree(block);
		return 0;
	}
	if (!OpenClipboard(0)) {
		GlobalFree(block);
		return -1;
	}
	int written = 0;
	if (EmptyClipboard()) written = SetClipboardData(SHIM_CF_UNICODETEXT, block) ? 1 : 0;
	CloseClipboard();
	// Ownership moved to the clipboard only when the set succeeded.
	if (!written) GlobalFree(block);
	return written;
}

// 1 when every clipboard entry point resolved; 0 on a machine where one is absent, which the
// adapter reports by name instead of calling a null pointer.
int shim_clipboard_ready(void) { return shim_win32_load() ? 1 : 0; }
