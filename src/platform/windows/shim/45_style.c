// --- the style members: always-on-top, decorations, opacity, fullscreen -----
// The five members the first pass refused because "the shim cannot read them back". Each is one
// Win32 write plus the read that proves it, and the read is what the adapter reports:
//
//   - always-on-top: `GetWindowLongPtrW(GWL_EXSTYLE) & WS_EX_TOPMOST`, the bit `SetWindowPos` wrote;
//   - decorations:  `GWL_STYLE & WS_CAPTION`, the bit the style write just cleared;
//   - opacity:      `GetLayeredWindowAttributes`, the alpha the call just applied;
//   - style:        read back after the write, so a refused `SetWindowLongPtrW` is a 0 rather than a
//                   repaint that never happened.
//
// `GWL_STYLE` and `GWL_EXSTYLE` are separate fields, so a decoration or fullscreen style write cannot
// clear `WS_EX_LAYERED`. If anything else ever did, `shim_window_alpha` reads the attribute back and
// answers 255 — the honest "fully opaque" — rather than the value somebody asked for.

// HWND_TOPMOST (-1) or HWND_NOTOPMOST (-2) and nothing else: a raise is what always-on-top means, so
// the z-order is the change. SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE keeps geometry and focus alone.
int shim_window_set_topmost(shim_h hwnd, int on) {
	if (!hwnd || !shim_win32_load()) return 0;
	return SetWindowPos(hwnd, on ? SHIM_HWND_TOPMOST : SHIM_HWND_NOTOPMOST, 0, 0, 0, 0,
	                    SHIM_SWP_TOPMOST)
	           ? 1
	           : 0;
}

int shim_window_is_topmost(shim_h hwnd) {
	if (!hwnd || !shim_win32_load()) return 0;
	return ((unsigned int)GetWindowLongPtrW(hwnd, SHIM_GWL_EXSTYLE) & SHIM_WS_EX_TOPMOST) ? 1 : 0;
}

// The style through an out parameter rather than a return: a style of 0 is legal (WS_OVERLAPPED), so
// a 0 return could not be told from a failed call. 1 written, 0 when the call could not be made.
int shim_window_style(shim_h hwnd, int *out) {
	if (!hwnd || !out || !shim_win32_load()) return 0;
	*out = (int)GetWindowLongPtrW(hwnd, SHIM_GWL_STYLE);
	return 1;
}

// `SetWindowLongPtrW` answers the *previous* style, which is not a success code, so the proof is the
// read-back. SWP_FRAMECHANGED is what repaints the non-client area; without it the window keeps its
// old frame until something unrelated resizes it.
int shim_window_set_style(shim_h hwnd, int style) {
	int now;
	if (!hwnd || !shim_win32_load()) return 0;
	SetWindowLongPtrW(hwnd, SHIM_GWL_STYLE, (shim_i64)style);
	if (!SetWindowPos(hwnd, 0, 0, 0, 0, 0, SHIM_SWP_FRAME_ONLY)) return 0;
	if (!shim_window_style(hwnd, &now)) return 0;
	return now == style ? 1 : 0;
}

// WS_OVERLAPPEDWINDOW's five bits, all together: clearing only WS_CAPTION leaves a resize border that
// still swallows clicks, and adding them back one at a time leaves a frame that does not repaint.
int shim_window_set_decorated(shim_h hwnd, int on) {
	int style;
	int next;
	if (!hwnd || !shim_win32_load()) return 0;
	if (!shim_window_style(hwnd, &style)) return 0;
	next = on ? (int)((unsigned int)style | SHIM_WS_FRAME) : (int)((unsigned int)style & ~SHIM_WS_FRAME);
	if (next != style && !shim_window_set_style(hwnd, next)) return 0;
	return shim_window_is_decorated(hwnd) == (on ? 1 : 0) ? 1 : 0;
}

int shim_window_is_decorated(shim_h hwnd) {
	int style;
	if (!hwnd || !shim_win32_load()) return 0;
	if (!shim_window_style(hwnd, &style)) return 0;
	return ((unsigned int)style & SHIM_WS_CAPTION) ? 1 : 0;
}

// WS_EX_LAYERED first, then the alpha: `SetLayeredWindowAttributes` fails on a window that is not
// layered, which is the ordering every sample has. The ex-style write gets the same FRAMECHANGED
// refresh as the style write, because a layered bit can otherwise sit there unapplied.
int shim_window_set_alpha(shim_h hwnd, int alpha) {
	unsigned int ex;
	if (!hwnd || !shim_win32_load()) return 0;
	if (alpha < 0) alpha = 0;
	if (alpha > 255) alpha = 255;
	ex = (unsigned int)GetWindowLongPtrW(hwnd, SHIM_GWL_EXSTYLE);
	if (!(ex & SHIM_WS_EX_LAYERED)) {
		SetWindowLongPtrW(hwnd, SHIM_GWL_EXSTYLE, (shim_i64)(ex | SHIM_WS_EX_LAYERED));
		if (!SetWindowPos(hwnd, 0, 0, 0, 0, 0, SHIM_SWP_FRAME_ONLY)) return 0;
	}
	return SetLayeredWindowAttributes(hwnd, 0u, (unsigned char)alpha, SHIM_LWA_ALPHA) ? 1 : 0;
}

// 0..255, or -1 when a layered window's alpha could not be read. A window that is not layered at all
// is 255: it is fully opaque, which is a fact rather than a failure.
int shim_window_alpha(shim_h hwnd) {
	unsigned int key = 0u;
	unsigned int flags = 0u;
	unsigned char alpha = 255u;
	if (!hwnd || !shim_win32_load()) return -1;
	if (!((unsigned int)GetWindowLongPtrW(hwnd, SHIM_GWL_EXSTYLE) & SHIM_WS_EX_LAYERED)) return 255;
	if (!GetLayeredWindowAttributes(hwnd, &key, &alpha, &flags)) return -1;
	return (int)alpha;
}
