// --- the browser surface's vtable slots ------------------------------------
// Split from `10_prelude.c` at the line cap, and on the seam `slots.test.ts` reads: every index here is
// counted from the published `ICoreWebView2` declaration order, after IUnknown's three methods, and the
// test re-derives each one from a transcribed method list rather than trusting the number.
// The browser surface's own members, counted the same way from the same published order. `7` is
// add_NavigationStarting, `15` add_NavigationCompleted, `38`/`39` get_CanGoBack/get_CanGoForward,
// `44` add_NewWindowRequested and `48` get_DocumentTitle; each is re-derived by `slots.test.ts`.
#define SHIM_SLOT_WEBVIEW_ADD_NAV_STARTING 7 // ICoreWebView2::add_NavigationStarting
#define SHIM_SLOT_WEBVIEW_ADD_NAV_COMPLETED 15 // ICoreWebView2::add_NavigationCompleted
#define SHIM_SLOT_WEBVIEW_CAN_GO_BACK 38      // ICoreWebView2::get_CanGoBack
#define SHIM_SLOT_WEBVIEW_CAN_GO_FORWARD 39   // ICoreWebView2::get_CanGoForward
#define SHIM_SLOT_WEBVIEW_ADD_NEW_WINDOW 44   // ICoreWebView2::add_NewWindowRequested
#define SHIM_SLOT_WEBVIEW_GET_TITLE 48        // ICoreWebView2::get_DocumentTitle
// ICoreWebView2NewWindowRequestedEventArgs, after IUnknown: get_Uri, put_NewWindow, get_NewWindow,
// put_Handled. Only the two this layer calls are named.
#define SHIM_SLOT_NEWWINDOW_GET_URI 3
#define SHIM_SLOT_NEWWINDOW_PUT_HANDLED 6
