# win-arm-shim (W2)

Read-only on Windows: this machine is darwin arm64. Everything below is static, plus a Bun cross-compile probe.

## Bun can target it

`bun build --compile --target=bun-windows-arm64 --outfile <tmp>/probe.exe` on a trivial entry answered
0 and wrote a 100 MB PE image. So W1's target row has a compiler behind it. The image was not run.

## Findings

| file:line | x64 assumption | arm64 behaviour | fix |
| --- | --- | --- | --- |
| `34_slots.c:13-27` | `put_Bounds` takes `RECT` by pointer: x64 passes composites >8 bytes by reference | AAPCS64 stage B.3 copies only composites >16 bytes; rule C.10 loads 16 bytes into consecutive GPRs, and TCC's `arm64_pcs_aux` implements C.10 | `#if defined(__aarch64__)` with a `shim_rect` by-value call; x64 branch unchanged |
| `36_probe.c:129-145`, `42_webview.c:94-101` | the 4096-byte frame rule explained only via x86-64 `gfunc_prolog` | PE `arm64_sub_sp` calls `__chkstk` at `diff >= 4096` with the size in x15; no libtcc1, so equally unresolved | comment updated: the rule is ABI-wide, `frame.test.ts` already guards both |
| `30_com.c:40-45` | `AddRef`/`Release` return `shim_u64` for a 32-bit `ULONG` | 32-bit ops zero-extend to 64 on ARM64, so low bits stay correct; not a break, only a wider-than-needed declaration | none; recorded so it is not re-fixed |
| `14_guard.c:12`, `20_class.c:3-17`, `47_screen.c:12-15` | fixed byte offsets/sizes justified "on x64" | `long`/`DWORD` stay 32-bit and pointers/`SIZE_T` stay 64-bit in Windows LLP64 on both ABIs, so 48/80/104/24 bytes are identical | none; comments left as measured history |

No width mismatch in any of the 69 `bun:ffi` declarations: `bun test src/platform/windows/ffi-abi.test.ts`
is green, and `src/platform/windows/abi-width.test.ts` still covers the Win32 entry-point returns.

## Proof

- `bun test src/platform/windows/ffi-abi.test.ts src/platform/windows/frame.test.ts src/platform/windows/abi-width.test.ts`: 22 pass, 0 fail.
- The arm64 assertion was red before the `34_slots.c` fix (6 pass / 1 fail) and green after.
- `clang -fsyntax-only -std=c11 -Wall` on the assembled `shimSource`: no output.
- `bun check src/platform/windows/c-abi.ts src/platform/windows/ffi-abi.test.ts`: clean.
- Nothing here was executed on Windows arm64; the by-value call is proven against the published ABI and TCC's code generator, not a runner.

## Read-only note: `48_keychain.c` (owned by F3 / BRIEF-2)

- `48_keychain.c:111`, `:135`, `:157`, `:171` declare `kc_wchar target/prefix[2048]` = 4096-byte locals. That is
  the `__chkstk` frame, and this unit is compiled separately by `keychain-ffi.ts`, so `frame.test.ts`
  (which reads only `SHIM_PART_NAMES`) does not see it. Filed, not fixed.
- Its declarations are width-correct as read: `set` I32 `[P,I64,P,I64,P,I64]`, `get` I64, `delete` I32,
  `list` I64 `[P,I64,I32,P,I64]`. The file was mid-edit; re-check after that lane lands.
- `keychain-ffi.ts:23` uses `ACCOUNT_BYTES = 4096`; no width or ARM64 issue in what was read.

## Declaration ↔ C prototype table

Widths are byte widths; every pair agrees. Generated from `c-abi.ts`, the same parser the test uses.

### ffi.ts

| symbol | C prototype | FFI declaration | widths |
| --- | --- | --- | --- |
| shim_win32_ready | int shim_win32_ready() | I32 () | 4 vs 4 |
| shim_com_init | shim_i64 shim_com_init() | I64 () | 8 vs 8 |
| shim_last_error | shim_i64 shim_last_error() | I64 () | 8 vs 8 |
| shim_register_class | shim_i64 shim_register_class(const char *name) | I64 (CS) | 8/8 vs 8/8 |
| shim_pump | int shim_pump() | I32 () | 4 vs 4 |
| shim_post_quit | void shim_post_quit() | V () | 0 vs 0 |
| shim_window_new | shim_h shim_window_new(const char *title, int, int, const char *cls) | P (CS, I32, I32, CS) | 8/8/4/4/8 vs 8/8/4/4/8 |
| shim_window_is_open | int shim_window_is_open(shim_h) | I32 (P) | 4/8 vs 4/8 |
| shim_window_set_title | int shim_window_set_title(shim_h, const char *title) | I32 (P, CS) | 4/8/8 vs 4/8/8 |
| shim_window_destroy | int shim_window_destroy(shim_h) | I32 (P) | 4/8 vs 4/8 |
| shim_window_set_min | void shim_window_set_min(shim_h, int, int) | V (P, I32, I32) | 0/8/4/4 vs 0/8/4/4 |
| shim_window_client_num | int shim_window_client_num(shim_h, int) | I32 (P, I32) | 4/8/4 vs 4/8/4 |
| shim_window_set_material | int shim_window_set_material(shim_h, int) | I32 (P, I32) | 4/8/4 vs 4/8/4 |
| shim_screen_count | int shim_screen_count() | I32 () | 4 vs 4 |
| shim_screen_info | int shim_screen_info(int, double *out) | I32 (I32, P) | 4/4/8 vs 4/4/8 |
| shim_webview_new | int shim_webview_new(shim_h, const char *url, const char *userData) | I32 (P, CS, CS) | 4/8/8/8 vs 4/8/8/8 |
| shim_webview_put_bounds | int shim_webview_put_bounds(shim_h, double, double) | I32 (P, F64, F64) | 4/8/8/8 vs 4/8/8/8 |
| shim_webview_close | void shim_webview_close(shim_h) | V (P) | 0/8 vs 0/8 |
| shim_env_begin | shim_i64 shim_env_begin(shim_h, const char *userData) | I64 (P, CS) | 8/8/8 vs 8/8/8 |
| shim_env_wait | int shim_env_wait() | I32 () | 4 vs 4 |
| shim_env_callback | shim_i64 shim_env_callback() | I64 () | 8 vs 8 |
| shim_controller_begin | shim_i64 shim_controller_begin(shim_h) | I64 (P) | 8/8 vs 8/8 |
| shim_controller_wait | int shim_controller_wait() | I32 () | 4 vs 4 |
| shim_controller_callback | shim_i64 shim_controller_callback() | I64 () | 8 vs 8 |
| shim_webview_attach | int shim_webview_attach(shim_h) | I32 (P) | 4/8 vs 4/8 |
| shim_webview_navigate | int shim_webview_navigate(const char *url) | I32 (CS) | 4/8 vs 4/8 |
| shim_navigate_hresult | int shim_navigate_hresult() | I32 () | 4 vs 4 |
| shim_webview_source | int shim_webview_source() | I32 () | 4 vs 4 |
| shim_webview_navigate_string | int shim_webview_navigate_string() | I32 () | 4 vs 4 |
| shim_controller_visible | int shim_controller_visible() | I32 () | 4 vs 4 |
| shim_webview_bind | int shim_webview_bind(shim_h) | I32 (P) | 4/8 vs 4/8 |
| shim_webview_size | int shim_webview_size(shim_h) | I32 (P) | 4/8 vs 4/8 |
| shim_webview_handle | void * shim_webview_handle() | P () | 8 vs 8 |
| shim_attach_hresult | shim_i64 shim_attach_hresult(int) | I64 (I32) | 8/4 vs 8/4 |
| shim_env_inline | int shim_env_inline() | I32 () | 4 vs 4 |
| shim_ctrl_from | int shim_ctrl_from() | I32 () | 4 vs 4 |
| shim_ctrl_inline | int shim_ctrl_inline() | I32 () | 4 vs 4 |
| shim_ctrl_mode | int shim_ctrl_mode(int) | I32 (I32) | 4/4 vs 4/4 |
| shim_window_thread | int shim_window_thread(shim_h) | I32 (P) | 4/8 vs 4/8 |
| shim_apartment_type | int shim_apartment_type() | I32 () | 4 vs 4 |
| shim_apartment_bound | int shim_apartment_bound() | I32 () | 4 vs 4 |
| shim_apartment_hresult | shim_i64 shim_apartment_hresult() | I64 () | 8 vs 8 |
| shim_apartment_qualifier | int shim_apartment_qualifier() | I32 () | 4 vs 4 |
| shim_object_state | int shim_object_state(void *obj) | I32 (P) | 4/8 vs 4/8 |
| shim_bad_object | int shim_bad_object() | I32 () | 4 vs 4 |
| shim_object_bytes | int shim_object_bytes(void *obj, void *out, int) | I32 (P, P, I32) | 4/8/8/4 vs 4/8/8/4 |
| shim_handler_created | void * shim_handler_created(int) | P (I32) | 8/4 vs 8/4 |
| shim_handler_addref | int shim_handler_addref(int) | I32 (I32) | 4/4 vs 4/4 |
| shim_controller_addr | void * shim_controller_addr() | P () | 8 vs 8 |
| shim_environment_addr | void * shim_environment_addr() | P () | 8 vs 8 |
| shim_controller_vtbl | void * shim_controller_vtbl() | P () | 8 vs 8 |
| shim_controller_slot | void * shim_controller_slot(int) | P (I32) | 8/4 vs 8/4 |
| shim_webview_vtbl | void * shim_webview_vtbl() | P () | 8 vs 8 |
| shim_webview_slot | void * shim_webview_slot(int) | P (I32) | 8/4 vs 8/4 |
| shim_bad_slot | int shim_bad_slot() | I32 () | 4 vs 4 |
| shim_env_hresult | shim_i64 shim_env_hresult() | I64 () | 8 vs 8 |
| shim_controller_hresult | shim_i64 shim_controller_hresult() | I64 () | 8 vs 8 |
| shim_thread_at | unsigned int shim_thread_at(int) | FFIType.u32 (I32) | 4/4 vs 4/4 |
| shim_thread_id | unsigned int shim_thread_id() | FFIType.u32 () | 4 vs 4 |
| shim_handler_prepare | int shim_handler_prepare() | I32 () | 4 vs 4 |
| shim_handler_vtbl_addr | shim_i64 shim_handler_vtbl_addr() | P () | 8 vs 8 |
| shim_handler_object_addr | shim_i64 shim_handler_object_addr() | P () | 8 vs 8 |
| shim_handler_first_field | shim_i64 shim_handler_first_field() | P () | 8 vs 8 |
| shim_handler_entry | shim_i64 shim_handler_entry(int) | P (I32) | 8/4 vs 8/4 |

### keychain-ffi.ts (read-only; F3 / BRIEF-2 own it)

| symbol | C prototype | FFI declaration | widths |
| --- | --- | --- | --- |
| shim_keychain_available | int shim_keychain_available() | I32 () | 4 vs 4 |
| shim_keychain_set | int shim_keychain_set(const char *service, long long, const char *account, long long, const char *secret, long long) | I32 (P, I64, P, I64, P, I64) | 4/8/8/8/8/8/8 vs 4/8/8/8/8/8/8 |
| shim_keychain_get | long long shim_keychain_get(const char *service, long long, const char *account, long long, char *dst, long long) | I64 (P, I64, P, I64, P, I64) | 8/8/8/8/8/8/8 vs 8/8/8/8/8/8/8 |
| shim_keychain_delete | int shim_keychain_delete(const char *service, long long, const char *account, long long) | I32 (P, I64, P, I64) | 4/8/8/8/8 vs 4/8/8/8/8 |
| shim_keychain_list | long long shim_keychain_list(const char *service, long long, kc_dword, char *dst, long long) | I64 (P, I64, I32, P, I64) | 8/8/8/4/8/8 vs 8/8/8/4/8/8 |
