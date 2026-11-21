// --- `crust:pty` on Windows: the reader and the four calls ------------------
// Last part of the ConPTY unit, in the same translation unit as `63_pty.c`: the statics and the
// slot struct are shared, `64` resolves the entry points and `65` opens the slot.
//
// Output is drained by a thread of its own, never by the caller: `ReadFile` on a console pipe
// blocks until the child writes, and the JavaScript thread is the one that pumps the app. The
// thread appends into a per-slot ring; `shim_pty_read` copies out whatever has arrived, so a poll
// from JavaScript cannot block and a chatty program cannot grow memory without bound.

static void shim_pty_push(shim_pty_slot *slot, unsigned char byte) {
	int next = (slot->head + 1) % SHIM_PTY_RING;
	// Full: drop the oldest byte rather than the newest, so a page that stops polling loses the
	// front of a flood instead of the line the program just wrote.
	if (next == slot->tail) slot->tail = (slot->tail + 1) % SHIM_PTY_RING;
	slot->ring[slot->head] = byte;
	slot->head = next;
}

// The reader thread. It ends when the console closes the output pipe — `shim_pty_close` does that
// through `ClosePseudoConsole`, which is why close must happen before the handles are released.
unsigned long shim_pty_reader(void *arg) {
	shim_pty_slot *slot = (shim_pty_slot *)arg;
	char buffer[2048];
	for (;;) {
		unsigned int got = 0;
		if (!ReadFile(slot->output, buffer, (unsigned int)sizeof(buffer), &got, 0)) break;
		if (got == 0) break;
		EnterCriticalSection(&slot->lock);
		for (unsigned int i = 0; i < got; i++) shim_pty_push(slot, (unsigned char)buffer[i]);
		LeaveCriticalSection(&slot->lock);
	}
	return 0;
}

// What has arrived since the last call, up to `cap` bytes. 0 means "nothing yet"; -1 is a bad index.
int shim_pty_read(int index, char *dst, int cap) {
	shim_pty_slot *slot = shim_pty_at(index);
	if (!slot || !dst || cap <= 0) return -1;
	EnterCriticalSection(&slot->lock);
	int count = 0;
	while (slot->tail != slot->head && count < cap) {
		dst[count++] = (char)slot->ring[slot->tail];
		slot->tail = (slot->tail + 1) % SHIM_PTY_RING;
	}
	LeaveCriticalSection(&slot->lock);
	return count;
}

// Type into the console. Answers the bytes accepted, or -1 with `shim_pty_reason`.
int shim_pty_write(int index, const void *data, int length) {
	shim_pty_slot *slot = shim_pty_at(index);
	if (!slot || !data || length <= 0) return -1;
	unsigned int wrote = 0;
	if (!WriteFile(slot->input, data, (unsigned int)length, &wrote, 0)) {
		shim_pty_fail("WriteFile to the console's input returned FALSE", GetLastError());
		return -1;
	}
	return (int)wrote;
}

// The size the program inside reads back from its console. 1 resized, 0 refused.
int shim_pty_resize(int index, int cols, int rows) {
	shim_pty_slot *slot = shim_pty_at(index);
	if (!slot) return 0;
	shim_pty_coord size;
	size.x = (short)cols;
	size.y = (short)rows;
	// `ResizePseudoConsole` is an HRESULT too: 0 is success, so only a negative value is a refusal.
	int resized = ResizePseudoConsole(slot->console, size);
	if (resized < 0) {
		shim_pty_fail_hresult("ResizePseudoConsole answered", resized);
		return 0;
	}
	return 1;
}

// 0 the child is running, 1 it exited (its code is `shim_pty_exit_code`), -1 a bad index.
// Polled rather than signalled: the handle lives for the app's lifetime, so a wait object would
// have to be added to a pump the app already owns.
int shim_pty_state(int index) {
	shim_pty_slot *slot = shim_pty_at(index);
	if (!slot) return -1;
	if (!slot->finished && WaitForSingleObject(slot->process, 0) == SHIM_PTY_WAIT_OBJECT) {
		unsigned int code = 0;
		GetExitCodeProcess(slot->process, &code);
		slot->exit_code = code;
		slot->finished = 1;
	}
	return slot->finished ? 1 : 0;
}

// The child's own exit code, or -1 while it runs. Never the pty's lifecycle number.
int shim_pty_exit_code(int index) {
	shim_pty_slot *slot = shim_pty_at(index);
	return slot ? (int)slot->exit_code : -1;
}

// End the child without releasing the handle, so `pty.close` can be the only close the page sees.
int shim_pty_kill(int index) {
	shim_pty_slot *slot = shim_pty_at(index);
	if (!slot) return 0;
	if (slot->finished) return 1;
	if (!TerminateProcess(slot->process, 1)) {
		shim_pty_fail("TerminateProcess returned FALSE", GetLastError());
		return 0;
	}
	WaitForSingleObject(slot->process, 2000);
	return 1;
}

// Hang up and release everything. Idempotent, and it answers 1 once the slot is free.
// The order matters: the child first (so the console has no client left), then
// `ClosePseudoConsole` (which breaks the output pipe and ends the reader), then the handles.
int shim_pty_close(int index) {
	if (index < 0 || index >= SHIM_PTY_MAX) return 0;
	shim_pty_slot *slot = &g_pty[index];
	if (!slot->used) return 1;
	if (!slot->finished && WaitForSingleObject(slot->process, 0) != SHIM_PTY_WAIT_OBJECT) {
		TerminateProcess(slot->process, 1);
		WaitForSingleObject(slot->process, 3000);
	}
	if (!slot->finished) {
		unsigned int code = 0;
		GetExitCodeProcess(slot->process, &code);
		slot->exit_code = code;
		slot->finished = 1;
	}
	if (slot->console) ClosePseudoConsole(slot->console);
	slot->console = 0;
	int joined = 1;
	if (slot->reader) {
		// The reader is blocked in ReadFile until the console's end of the pipe goes; the wait is a
		// bound on that, not a synchronisation point the pty needs.
		joined = WaitForSingleObject(slot->reader, 3000) == SHIM_PTY_WAIT_OBJECT;
		CloseHandle(slot->reader);
		slot->reader = 0;
	}
	if (slot->input) CloseHandle(slot->input);
	if (slot->output) CloseHandle(slot->output);
	if (slot->process) CloseHandle(slot->process);
	if (slot->thread) CloseHandle(slot->thread);
	slot->input = 0;
	slot->output = 0;
	slot->process = 0;
	slot->thread = 0;
	slot->closed = 1;
	if (!joined) {
		// A reader that never saw the pipe break still holds this slot, so it is never reused: a
		// second open on it would hand a thread memory that was zeroed under it.
		shim_pty_fail("the reader thread did not end, so this pseudo-console stays spent", 0);
		return 0;
	}
	DeleteCriticalSection(&slot->lock);
	// Freed for the next open, which zeroes the slot first; `exit_code` stays readable until then.
	slot->used = 0;
	shim_pty_fail("the pseudo-console is closed", 0);
	return 1;
}
