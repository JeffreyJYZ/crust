// --- snapshot flatness: is the finished bitmap one colour? ------------------
// Joined into the snapshot unit by snapshot-unit.ts, after 123_snapshot.c's helpers: this reads
// the same NSBitmapImageRep the PNG was encoded from, so it measures the picture WebKit handed
// back rather than compressed bytes. A platform fact, never a reason on its own — the composited
// bit beside it is what separates a never-drawn view from a page that meant to be one flat colour.

// One distinct colour and zero differing pixels. 0 when the layout is not the 8-bit one WebKit
// writes, so an unknown never turns into a refusal.
static int shot_bitmap_flat(shot_t rep) {
	unsigned char *data;
	long long stride, samples, w, h, row, x, y, i;
	if (!rep || !shot_has(rep, "bitmapData")) return 0;
	if (shot_integer(rep, "bitsPerSample") != 8) return 0;
	data = ((unsigned char *(*)(void *, void *))objc_msgSend)(rep, sel_registerName("bitmapData"));
	if (!data) return 0;
	stride = shot_integer(rep, "bytesPerRow");
	samples = shot_integer(rep, "samplesPerPixel");
	w = shot_integer(rep, "pixelsWide");
	h = shot_integer(rep, "pixelsHigh");
	row = w * samples;
	if (stride <= 0 || samples <= 0 || w <= 0 || h <= 0 || row <= 0 || row > stride) return 0;
	// Every pixel equals the first one, and every row repeats the first one's bytes.
	for (x = samples; x < row; x++)
		if (data[x] != data[x % samples]) return 0;
	for (y = 1; y < h; y++)
		for (i = 0; i < row; i++)
			if (data[y * stride + i] != data[i]) return 0;
	return 1;
}
