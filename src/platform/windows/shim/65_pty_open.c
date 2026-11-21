// --- `crust:pty` on Windows: one pseudo-console and its shell --------------
// Third part of the ConPTY unit. The slot table is the handle the page names: an index in, an index
// out, and no HPCON or HANDLE ever crosses bun:ffi.
//
// The two pipe pairs are the console's wire — the console reads `in_read` and writes `out_write`,
// this side keeps `in_write` and `out_read` and closes the console's ends as soon as it has them.
// The child is started with `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`, which is the whole of what makes
// an ordinary `CreateProcessW` attached to a console it did not allocate.
/** The slot behind an index, or NULL: every entry point below routes through this. */
static shim_pty_slot *shim_pty_at(int index) {
	if (index < 0 || index >= SHIM_PTY_MAX) return 0;
	shim_pty_slot *slot = &g_pty[index];
	return slot->used && !slot->closed ? slot : 0;
}

/** The child's pid, or 0 for an index that is not a live handle. */
int shim_pty_pid(int index) {
	shim_pty_slot *slot = shim_pty_at(index);
	return slot ? (int)slot->pid : 0;
}

// Open one pseudo-console and its shell. Answers the slot index, or -1 with `shim_pty_reason`.
// The two pipe pairs are the console's wire: the console reads `in_read` and writes `out_write`,
// this side keeps `in_write` and `out_read` and closes the console's ends as soon as it has them.
int shim_pty_open(const char *shell, const char *args, const char *cwd, const shim_wchar *env,
                  int cols, int rows) {
	if (!shim_pty_load()) return -1;
	int index = -1;
	for (int i = 0; i < SHIM_PTY_MAX; i++) {
		if (!g_pty[i].used) {
			index = i;
			break;
		}
	}
	if (index < 0) {
		shim_pty_fail("all four pseudo-consoles are in use", 0);
		return -1;
	}
	shim_pty_slot *slot = &g_pty[index];
	shim_pty_zero(slot, sizeof(*slot));
	// Inheritable, so the console host can hold the ends it is given; see `shim_pty_security`.
	shim_pty_security attrs;
	shim_pty_zero(&attrs, sizeof(attrs));
	attrs.nLength = (unsigned int)sizeof(attrs);
	attrs.bInheritHandle = 1;
	shim_h in_read = 0;
	shim_h in_write = 0;
	shim_h out_read = 0;
	shim_h out_write = 0;
	if (!CreatePipe(&in_read, &in_write, &attrs, 0)) {
		shim_pty_fail("CreatePipe for the console's input returned FALSE", GetLastError());
		return -1;
	}
	if (!CreatePipe(&out_read, &out_write, &attrs, 0)) {
		CloseHandle(in_read);
		CloseHandle(in_write);
		shim_pty_fail("CreatePipe for the console's output returned FALSE", GetLastError());
		return -1;
	}
	shim_pty_coord size;
	size.x = (short)cols;
	size.y = (short)rows;
	void *console = 0;
	// `CreatePseudoConsole` answers an HRESULT, not a BOOL: `S_OK` is 0, so success is `hr >= 0`
	// and testing `!hr` would read every opened console as a refusal.
	int opened = CreatePseudoConsole(size, in_read, out_write, 0, &console);
	if (opened < 0) {
		CloseHandle(in_read);
		CloseHandle(in_write);
		CloseHandle(out_read);
		CloseHandle(out_write);
		shim_pty_fail_hresult("CreatePseudoConsole answered", opened);
		return -1;
	}
	// The console owns its ends now. Holding them into close instead blocks `ClosePseudoConsole`,
	// which waits for the host to finish: measured on windows-latest, the smoke hung there for nine
	// minutes. What the console host needs is inheritable pipes, not a second owner.
	CloseHandle(in_read);
	CloseHandle(out_write);
	shim_h heap = GetProcessHeap();
	shim_u64 bytes = 0;
	InitializeProcThreadAttributeList(0, 1, 0, &bytes);
	void *list = HeapAlloc(heap, 0, bytes);
	if (!list || !InitializeProcThreadAttributeList(list, 1, 0, &bytes)) {
		ClosePseudoConsole(console);
		CloseHandle(in_write);
		CloseHandle(out_read);
		shim_pty_fail("InitializeProcThreadAttributeList returned FALSE", GetLastError());
		return -1;
	}
	// The value is the HPCON itself, not its address. Microsoft's own pseudoconsole sample passes
	// `hPC, sizeof(HPCON)`; with `&console` CreateProcessW still answers TRUE, the child runs, the
	// console host holds both pipes and no client ever attaches — measured as a silent pty on
	// windows-latest 2026-11-21.
	if (!UpdateProcThreadAttribute(list, 0, SHIM_PTY_ATTRIBUTE, console, sizeof(console), 0, 0)) {
		DeleteProcThreadAttributeList(list);
		HeapFree(heap, 0, list);
		ClosePseudoConsole(console);
		CloseHandle(in_write);
		CloseHandle(out_read);
		shim_pty_fail("UpdateProcThreadAttribute(PSEUDOCONSOLE) returned FALSE", GetLastError());
		return -1;
	}
	shim_pty_startup startup;
	shim_pty_zero(&startup, sizeof(startup));
	startup.cb = (unsigned int)sizeof(startup);
	startup.lpAttributeList = list;
	startup.dwFlags = SHIM_PTY_USESTD;
	startup.hStdInput = SHIM_PTY_NO_HANDLE;
	startup.hStdOutput = SHIM_PTY_NO_HANDLE;
	startup.hStdError = SHIM_PTY_NO_HANDLE;
	shim_pty_info info;
	shim_pty_zero(&info, sizeof(info));
	// 512 UTF-16 code units each, never 1024: two 2048-byte arrays in one frame reach TinyCC's
	// 4096-byte prologue, which calls the undefined `__chkstk` and dies before the first line.
	shim_wchar command[512];
	shim_wchar directory[512];
	int length = shim_pty_wide(shell, command + 1, 510);
	if (length < 0) {
		DeleteProcThreadAttributeList(list);
		HeapFree(heap, 0, list);
		ClosePseudoConsole(console);
		CloseHandle(in_write);
		CloseHandle(out_read);
		shim_pty_fail("the configured shell did not convert to UTF-16", 0);
		return -1;
	}
	// Quoted, because a shell path with a space is otherwise two arguments. CreateProcessW may write
	// to this buffer, which is why it is a stack array rather than a string literal.
	command[0] = '"';
	command[length + 1] = '"';
	command[length + 2] = 0;
	// The probe's arguments, so a proof can run `cmd /c echo` instead of an interactive banner.
	// A conversion that does not fit is a spawn failure, not a shell with the whole argument string
	// silently dropped: the caller asked for those arguments and cannot tell they were lost.
	int at = length + 2;
	if (args && args[0] && at < 510) {
		command[at++] = ' ';
		int extra = shim_pty_wide(args, command + at, 512 - at);
		if (extra < 0) {
			DeleteProcThreadAttributeList(list);
			HeapFree(heap, 0, list);
			ClosePseudoConsole(console);
			CloseHandle(in_write);
			CloseHandle(out_read);
			shim_pty_fail("the arguments did not fit beside the configured shell", 0);
			return -1;
		}
	}
	const shim_wchar *working = shim_pty_wide(cwd, directory, 512) >= 0 ? directory : 0;
	// `env` is a complete, double-NUL UTF-16 environment block built by the adapter (including
	// TERM). Passing 0 here inherited the host's environment and dropped every plugin override.
	int spawned = CreateProcessW(0, command, 0, 0, 0, SHIM_PTY_EXTENDED, (void *)env, working,
	                             &startup, &info);
	DeleteProcThreadAttributeList(list);
	HeapFree(heap, 0, list);
	if (!spawned) {
		ClosePseudoConsole(console);
		CloseHandle(in_write);
		CloseHandle(out_read);
		shim_pty_fail("CreateProcessW returned FALSE", GetLastError());
		return -1;
	}
	slot->console = console;
	slot->process = info.process;
	slot->thread = info.thread;
	slot->input = in_write;
	slot->output = out_read;
	slot->pid = info.pid;
	slot->used = 1;
	InitializeCriticalSection(&slot->lock);
	slot->reader = CreateThread(0, 0, shim_pty_reader, slot, 0, 0);
	if (!slot->reader) {
		shim_pty_fail("CreateThread for the reader returned NULL", GetLastError());
		TerminateProcess(slot->process, 1);
		WaitForSingleObject(slot->process, 2000);
		ClosePseudoConsole(console);
		CloseHandle(in_write);
		CloseHandle(out_read);
		CloseHandle(info.process);
		CloseHandle(info.thread);
		DeleteCriticalSection(&slot->lock);
		slot->used = 0;
		return -1;
	}
	shim_pty_fail("the pseudo-console is open", 0);
	return index;
}
