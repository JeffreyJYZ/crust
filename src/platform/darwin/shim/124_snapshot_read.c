// --- snapshot reads --------------------------------------------------------
// The second half of the snapshot unit, joined with 123_snapshot.c by snapshot-unit.ts: these read
// the statics that part's completion handler filled, and they live here only so neither file
// passes the line cap. Nothing here is a second marshalling path — the bytes cross exactly as
// 101_clipboard_image.c's do, a length first and then an exact-size copy.

long long crust_shot_width(void) { return shot_px_w; }

long long crust_shot_height(void) { return shot_px_h; }

// Bitmap pixels per point, measured from the picture: 2 on a Retina display, 1 on a plain one.
double crust_shot_scale(void) { return shot_scale; }

// 1 when the finished bitmap has one distinct colour and zero differing pixels. Read from the
// bitmap rep, not from compressed bytes: a caller still needs the composited bit to know whether
// this is a never-drawn view or a page that meant to be one flat colour.
int crust_shot_flat(void) { return shot_flat; }

// The full PNG length, so a caller whose buffer was too small can ask again with an exact one;
// -1 when no picture was taken.
long long crust_shot_length(void) { return shot_png ? shot_integer(shot_png, "length") : -1; }

// PNG bytes into `dst`, reporting the full length the way the clipboard image read does.
long long crust_shot_read(char *dst, long long cap) {
	long long length;
	const char *bytes;
	long long copied;
	long long i;
	if (!shot_png) return -1;
	length = shot_integer(shot_png, "length");
	if (length <= 0) return -1;
	if (!dst || cap <= 0) return length;
	bytes = ((const char *(*)(void *, void *))objc_msgSend)(shot_png, sel_registerName("bytes"));
	if (!bytes) return -1;
	copied = length < cap ? length : cap;
	for (i = 0; i < copied; i++) dst[i] = bytes[i];
	return length;
}

// 1 when the global completion block is built, which is the half a suite can prove with no window.
int crust_shot_block_ready(void) { return shot_block_init(); }
