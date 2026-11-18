// crust Linux shim — the keychain part. libsecret's synchronous API is a plain C ABI and creates its
// own private GMainContext/GMainLoop, so no caller main loop is needed; only a session bus and a
// running Secret Service provider (gnome-keyring, ksecretservice, KWallet). Every GLib allocation
// stays on this side: the lookup copies into a static buffer before returning, because Bun's mimalloc
// exports malloc/free and a GLib string freed through those faults (measured at 0xA6D0).

// Hand-written ABIs, no #include like every other part. SecretSchemaAttribute is {const char*, int};
// SecretSchema is {const char*, int, SecretSchemaAttribute[16]}. GError is {int domain, int code,
// char* message}. These are stable published layouts, not guessed from a version.
typedef struct { const char *name; int type; } SecretSchemaAttribute;
typedef struct {
	const char *name;
	int flags;
	SecretSchemaAttribute attributes[16];
} SecretSchema;
typedef struct { int domain; int code; char *message; } GErrorView;

typedef int (*fn_store)(const SecretSchema *, void *, const char *, const char *, const char *, void *, void **);
typedef char *(*fn_lookup)(const SecretSchema *, void *, void *, void **);
typedef int (*fn_clear)(const SecretSchema *, void *, void *, void **);
typedef void (*fn_secret_free)(char *);
typedef void *(*fn_hash_new)(void *, void *);
typedef void (*fn_hash_insert)(void *, void *, void *);
typedef void (*fn_hash_unref)(void *);
typedef unsigned int (*fn_str_hash)(const void *);
typedef int (*fn_str_equal)(const void *, const void *);
typedef void (*fn_error_free)(void *);

static void *shim_secret;
static void *shim_secret_store;
static void *shim_secret_lookup;
static void *shim_secret_clear;
static void *shim_secret_free;
static void *shim_hash_new;
static void *shim_hash_insert;
static void *shim_hash_unref;
static void *shim_str_hash;
static void *shim_str_equal;
static void *shim_error_free;

// One schema for every crust credential; the two string attributes carry the service and account.
static const SecretSchema shim_keyring_schema = {
	"org.crust.Keychain", 0,
	{ { "service", 0 }, { "account", 0 }, { 0, 0 } }
};

// A secret larger than this is refused rather than silently truncated. 64 KiB is far past any token.
#define SHIM_KEYRING_MAX 65536
static char shim_keyring_value[SHIM_KEYRING_MAX];

/** Open libsecret and resolve the synchronous simple API. Returns 1, or 0 with `shim_error` set. */
int shim_keyring_open(void) {
	if (shim_secret) return 1;
	shim_error[0] = 0;
	shim_secret = shim_open("libsecret-1.so.0");
	if (!shim_secret) return 0;
	if (!shim_sym(shim_secret, "secret_password_storev_sync", &shim_secret_store) ||
	    !shim_sym(shim_secret, "secret_password_lookupv_sync", &shim_secret_lookup) ||
	    !shim_sym(shim_secret, "secret_password_clearv_sync", &shim_secret_clear) ||
	    !shim_sym(shim_secret, "secret_password_free", &shim_secret_free) ||
	    !shim_sym(shim_secret, "g_hash_table_new", &shim_hash_new) ||
	    !shim_sym(shim_secret, "g_hash_table_insert", &shim_hash_insert) ||
	    !shim_sym(shim_secret, "g_hash_table_unref", &shim_hash_unref) ||
	    !shim_sym(shim_secret, "g_str_hash", &shim_str_hash) ||
	    !shim_sym(shim_secret, "g_str_equal", &shim_str_equal) ||
	    !shim_sym(shim_secret, "g_error_free", &shim_error_free)) {
		dlclose(shim_secret);
		shim_secret = 0;
		return 0;
	}
	return 1;
}

/** The attribute table the `v` variants take instead of the C varargs form. GLib-owned, released by caller. */
static void *shim_keyring_attrs(const char *service, const char *account) {
	void *attrs = ((fn_hash_new)shim_hash_new)((fn_str_hash)shim_str_hash, (fn_str_equal)shim_str_equal);
	if (!attrs) {
		shim_set_error("could not allocate keyring attributes", 0);
		return 0;
	}
	((fn_hash_insert)shim_hash_insert)(attrs, (void *)"service", (void *)service);
	((fn_hash_insert)shim_hash_insert)(attrs, (void *)"account", (void *)account);
	return attrs;
}

/** Turn a GError into the shared error text and release it. */
static void shim_keyring_error(const char *what, void *error) {
	if (!error) return;
	GErrorView *view = (GErrorView *)error;
	shim_set_error(what, view->message ? view->message : 0);
	((fn_error_free)shim_error_free)(error);
}

/** Store one credential. 1 stored, 0 refused with `shim_error` set. */
int shim_keyring_set(const char *service, const char *account, const char *secret) {
	if (!shim_secret && !shim_keyring_open()) return 0;
	void *error = 0;
	void *attrs = shim_keyring_attrs(service, account);
	if (!attrs) return 0;
	int ok = ((fn_store)shim_secret_store)(&shim_keyring_schema, attrs, 0, "crust", secret, 0, &error);
	((fn_hash_unref)shim_hash_unref)(attrs);
	if (error) {
		shim_keyring_error("libsecret refused the write", error);
		return 0;
	}
	return ok ? 1 : 0;
}

/**
 * Look one credential up. `*status`: 1 found (a static NUL string is returned), 0 not stored,
 * -1 refused with `shim_error` set, -2 longer than the static buffer. No GLib pointer crosses FFI.
 */
const char *shim_keyring_get(const char *service, const char *account, int *status) {
	if (!shim_secret && !shim_keyring_open()) {
		*status = -1;
		return 0;
	}
	void *error = 0;
	void *attrs = shim_keyring_attrs(service, account);
	if (!attrs) {
		*status = -1;
		return 0;
	}
	char *value = ((fn_lookup)shim_secret_lookup)(&shim_keyring_schema, attrs, 0, &error);
	((fn_hash_unref)shim_hash_unref)(attrs);
	if (error) {
		shim_keyring_error("libsecret refused the read", error);
		*status = -1;
		return 0;
	}
	if (!value) {
		*status = 0;
		return 0;
	}
	int i = 0;
	while (value[i] && i < SHIM_KEYRING_MAX - 1) {
		shim_keyring_value[i] = value[i];
		i++;
	}
	shim_keyring_value[i] = 0;
	// Read the source before freeing it: a non-NUL at the cut point means the secret was longer.
	int truncated = value[i] != 0;
	((fn_secret_free)shim_secret_free)(value);
	*status = truncated ? -2 : 1;
	return truncated ? 0 : shim_keyring_value;
}

/** Delete one credential. 1 removed, 0 nothing was stored, -1 refused with `shim_error` set. */
int shim_keyring_delete(const char *service, const char *account) {
	int status = 0;
	if (!shim_keyring_get(service, account, &status)) {
		return status == 0 ? 0 : -1;
	}
	if (!shim_secret && !shim_keyring_open()) return -1;
	void *error = 0;
	void *attrs = shim_keyring_attrs(service, account);
	if (!attrs) return -1;
	int ok = ((fn_clear)shim_secret_clear)(&shim_keyring_schema, attrs, 0, &error);
	((fn_hash_unref)shim_hash_unref)(attrs);
	if (error) {
		shim_keyring_error("libsecret refused the delete", error);
		return -1;
	}
	return ok ? 1 : 0;
}
