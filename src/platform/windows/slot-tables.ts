/**
 * Published WebView2 vtable method order, transcribed from WebView2.h (docs.rs/webview2-sys).
 * Every index this layer calls is position-in-list + 3, past IUnknown's QueryInterface/AddRef/Release.
 * Kept as data, not inside a test, so both the slot assertions and the pin-every-constant test read the
 * same list — a second copy would drift the way the NavigationStarting slots did.
 */

/** ICoreWebView2Environment. */
export const ENVIRONMENT = [
	"CreateCoreWebView2Controller",
	"CreateWebResourceResponse",
	"get_BrowserVersionString",
	"add_NewBrowserVersionAvailable",
	"remove_NewBrowserVersionAvailable",
];

/**
 * ICoreWebView2Controller: get_IsVisible, put_IsVisible, get_Bounds, put_Bounds, get_ZoomFactor,
 * put_ZoomFactor, add_ZoomFactorChanged, remove_ZoomFactorChanged, SetBoundsAndZoomFactor, MoveFocus,
 * add_MoveFocusRequested, remove_MoveFocusRequested, add_GotFocus, remove_GotFocus, add_LostFocus,
 * remove_LostFocus, add_AcceleratorKeyPressed, remove_AcceleratorKeyPressed, get_ParentWindow,
 * put_ParentWindow, NotifyParentWindowPositionChanged, Close, get_CoreWebView2.
 */
export const CONTROLLER = [
	"get_IsVisible",
	"put_IsVisible",
	"get_Bounds",
	"put_Bounds",
	"get_ZoomFactor",
	"put_ZoomFactor",
	"add_ZoomFactorChanged",
	"remove_ZoomFactorChanged",
	"SetBoundsAndZoomFactor",
	"MoveFocus",
	"add_MoveFocusRequested",
	"remove_MoveFocusRequested",
	"add_GotFocus",
	"remove_GotFocus",
	"add_LostFocus",
	"remove_LostFocus",
	"add_AcceleratorKeyPressed",
	"remove_AcceleratorKeyPressed",
	"get_ParentWindow",
	"put_ParentWindow",
	"NotifyParentWindowPositionChanged",
	"Close",
	"get_CoreWebView2",
];

/**
 * ICoreWebView2: get_Settings, get_Source, Navigate, NavigateToString, add/remove_NavigationStarting,
 * add/remove_ContentLoading, add/remove_SourceChanged, add/remove_HistoryChanged,
 * add/remove_NavigationCompleted, add/remove_FrameNavigationStarting,
 * add/remove_FrameNavigationCompleted, add/remove_ScriptDialogOpening,
 * add/remove_PermissionRequested, add/remove_ProcessFailed,
 * AddScriptToExecuteOnDocumentCreated, RemoveScriptToExecuteOnDocumentCreated, ExecuteScript,
 * CapturePreview, Reload, PostWebMessageAsJson, PostWebMessageAsString, add/remove_WebMessageReceived,
 * CallDevToolsProtocolMethod, get_BrowserProcessId, get_CanGoBack, get_CanGoForward, GoBack,
 * GoForward, GetDevToolsProtocolEventReceiver, Stop, add/remove_NewWindowRequested,
 * add/remove_DocumentTitleChanged, get_DocumentTitle.
 */
export const WEBVIEW = [
	"get_Settings",
	"get_Source",
	"Navigate",
	"NavigateToString",
	"add_NavigationStarting",
	"remove_NavigationStarting",
	"add_ContentLoading",
	"remove_ContentLoading",
	"add_SourceChanged",
	"remove_SourceChanged",
	"add_HistoryChanged",
	"remove_HistoryChanged",
	"add_NavigationCompleted",
	"remove_NavigationCompleted",
	"add_FrameNavigationStarting",
	"remove_FrameNavigationStarting",
	"add_FrameNavigationCompleted",
	"remove_FrameNavigationCompleted",
	"add_ScriptDialogOpening",
	"remove_ScriptDialogOpening",
	"add_PermissionRequested",
	"remove_PermissionRequested",
	"add_ProcessFailed",
	"remove_ProcessFailed",
	"AddScriptToExecuteOnDocumentCreated",
	"RemoveScriptToExecuteOnDocumentCreated",
	"ExecuteScript",
	"CapturePreview",
	"Reload",
	"PostWebMessageAsJson",
	"PostWebMessageAsString",
	"add_WebMessageReceived",
	"remove_WebMessageReceived",
	"CallDevToolsProtocolMethod",
	"get_BrowserProcessId",
	"get_CanGoBack",
	"get_CanGoForward",
	"GoBack",
	"GoForward",
	"GetDevToolsProtocolEventReceiver",
	"Stop",
	"add_NewWindowRequested",
	"remove_NewWindowRequested",
	"add_DocumentTitleChanged",
	"remove_DocumentTitleChanged",
	"get_DocumentTitle",
];

/**
 * ICoreWebView2NewWindowRequestedEventArgs: get_Uri, put_NewWindow, get_NewWindow, put_Handled,
 * get_Handled, get_IsUserInitiated, GetDeferral, get_WindowFeatures.
 */
export const NEW_WINDOW = [
	"get_Uri",
	"put_NewWindow",
	"get_NewWindow",
	"put_Handled",
	"get_Handled",
	"get_IsUserInitiated",
	"GetDeferral",
	"get_WindowFeatures",
];

/**
 * ICoreWebView2NavigationStartingEventArgs: get_Uri, get_IsUserInitiated, get_IsRedirected,
 * get_RequestHeaders, get_Cancel, put_Cancel, GetNavigationId. get_Uri is 3 and put_Cancel is 8;
 * the old off-by-one wrote a BOOL over a LPWSTR* and dereferenced address 1 on a real WebView2.
 */
export const NAV_ARGS = [
	"get_Uri",
	"get_IsUserInitiated",
	"get_IsRedirected",
	"get_RequestHeaders",
	"get_Cancel",
	"put_Cancel",
	"GetNavigationId",
];

/** The slot a published method list puts a method at, counting from 3 (past IUnknown). */
export function slotOf(order: readonly string[], method: string): number {
	return order.indexOf(method) + 3;
}
