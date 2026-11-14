// --- sends, one fixed prototype per arity/shape ----------------------------

obj_t shim_send_p0(obj_t r, obj_t s) {
	return ((obj_t (*)(void *, void *))objc_msgSend)(r, s);
}
obj_t shim_send_p1(obj_t r, obj_t s, obj_t a) {
	return ((obj_t (*)(void *, void *, void *))objc_msgSend)(r, s, a);
}
obj_t shim_send_p2(obj_t r, obj_t s, obj_t a, obj_t b) {
	return ((obj_t (*)(void *, void *, void *, void *))objc_msgSend)(r, s, a, b);
}
obj_t shim_send_p3(obj_t r, obj_t s, obj_t a, obj_t b, obj_t c) {
	return ((obj_t (*)(void *, void *, void *, void *, void *))objc_msgSend)(r, s, a, b, c);
}
obj_t shim_send_pq1(obj_t r, obj_t s, long long v) {
	return ((obj_t (*)(void *, void *, long long))objc_msgSend)(r, s, v);
}
obj_t shim_send_pb1(obj_t r, obj_t s, int v) {
	return ((obj_t (*)(void *, void *, int))objc_msgSend)(r, s, v);
}
obj_t shim_send_pd1(obj_t r, obj_t s, double v) {
	return ((obj_t (*)(void *, void *, double))objc_msgSend)(r, s, v);
}

// BOOL returns are 1 byte in w0; read them as char, never as a pointer.
int shim_send_b0(obj_t r, obj_t s) {
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(r, s);
}
int shim_send_b1(obj_t r, obj_t s, obj_t a) {
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(r, s, a);
}

// long long / unsigned long long returns (styleMask, windowNumber, policy).
long long shim_send_q0(obj_t r, obj_t s) {
	return ((long long (*)(void *, void *))objc_msgSend)(r, s);
}
long long shim_send_q1(obj_t r, obj_t s, long long v) {
	return ((long long (*)(void *, void *, long long))objc_msgSend)(r, s, v);
}

void shim_send_v0(obj_t r, obj_t s) {
	((void (*)(void *, void *))objc_msgSend)(r, s);
}
void shim_send_v1(obj_t r, obj_t s, obj_t a) {
	((void (*)(void *, void *, void *))objc_msgSend)(r, s, a);
}
void shim_send_v2(obj_t r, obj_t s, obj_t a, obj_t b) {
	((void (*)(void *, void *, void *, void *))objc_msgSend)(r, s, a, b);
}
void shim_send_vb1(obj_t r, obj_t s, int v) {
	((void (*)(void *, void *, int))objc_msgSend)(r, s, v);
}
void shim_send_vq1(obj_t r, obj_t s, long long v) {
	((void (*)(void *, void *, long long))objc_msgSend)(r, s, v);
}
void shim_send_vd1(obj_t r, obj_t s, double v) {
	((void (*)(void *, void *, double))objc_msgSend)(r, s, v);
}

// [[cls alloc] init] — the struct-free constructor pair.
obj_t shim_new(obj_t cls) {
	obj_t a = sel_registerName("alloc");
	obj_t i = sel_registerName("init");
	obj_t o = ((obj_t (*)(void *, void *))objc_msgSend)(cls, a);
	return o ? ((obj_t (*)(void *, void *))objc_msgSend)(o, i) : 0;
}

