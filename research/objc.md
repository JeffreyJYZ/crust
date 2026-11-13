# objc — selector inventory and type encodings for crust

Everything below is measured on this machine unless the line says otherwise.

- machine: macOS 27.0.1, arm64 (`uname -m` → `arm64`)
- runtime: `/usr/lib/libobjc.A.dylib` (dyld shared cache)
- bun: 1.4.4
- SDK: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk` (Xcode 27.0)

Two independent evidence paths, kept apart on purpose:

| tag | source | how |
| --- | --- | --- |
| **runtime** | the live Objective-C runtime | `class_getInstanceMethod` + `method_getTypeEncoding` through `dlopen`, **no selector is ever sent** |
| **header** | the SDK on disk | `rg` over `.../AppKit.framework/Headers/*.h` |

Nothing in the encoding tables came from a header. Headers were used only to settle selector *names*.

---

## 1. How the encodings were read

`class_getInstanceMethod` and `method_getTypeEncoding` are ordinary C symbols in
`libobjc`, so `bun:ffi` reaches them with no compiled helper — the brief's
suggestion works, verified.

```
bun run probe/encoding-probe.ts > probe/encoding.txt     # 205 rows, exit 0
```

Three facts that are not obvious and cost time:

1. **AppKit classes do not exist until the framework image is loaded.**
   `objc_getClass("NSApplication")` returned `null`, then a real pointer after
   `dlopen("/System/Library/Frameworks/AppKit.framework/AppKit")`.
   (`probe/smoke.ts`, `probe/smoke2.ts`)
2. **WebKit has no on-disk binary to `dlsym`.** `WebKit.framework/WebKit` does
   not exist as a file (dyld shared cache), and every anchor symbol lookup
   fails — but `dlopen` still loads the image and the classes register
   afterwards. So the load must be wrapped in `try/catch` and its failure
   ignored: `objc_getClass("WKWebView")` was `null` before and non-null after
   the swallowed `dlopen`. (`probe/smoke3.ts`)
3. **`dlopen(path, symbols)` in bun resolves every symbol eagerly.** An
   arbitrary `objc_msgSend` prototype therefore cannot be added to the symbol
   map. The workaround that works: read the address once
   (`symbol.ptr`, e.g. `0x18ad38800`) and build any prototype with
   `new CFunction({ ptr, args, returns })`. (`probe/abi-probe.ts`)

### Reproduce the selector verification table

```
bun run probe/abi-verify.ts verify
```

It prints `class_getInstanceMethod` / `class_getClassMethod` non-null and the
encoding side by side, so a wrong name is visible without sending it.

---

## 2. Selector → encoding

Read `+`/`-` as the kind. Offsets in the encoding (`@0:8@16`) are the
compiler's stack frame offsets; they carry no information crust needs.

### NSApplication

| selector | kind | encoding |
| --- | --- | --- |
| `sharedApplication` | + | `@16@0:8` |
| `finishLaunching` | − | `v16@0:8` |
| `setActivationPolicy:` | − | `B24@0:8q16` |
| `activateIgnoringOtherApps:` | − | `v20@0:8B16` |
| `run` | − | `v16@0:8` |
| `stop:` | − | `v24@0:8@16` |
| `terminate:` | − | `v24@0:8@16` |
| `setDelegate:` | − | `v24@0:8@16` |
| `delegate` | − | `@16@0:8` |
| `mainWindow` | − | `@16@0:8` |
| `windows` | − | `@16@0:8` |
| `hide:` | − | `v24@0:8@16` |
| `presentationOptions` | − | `Q16@0:8` |
| `setPresentationOptions:` | − | `v24@0:8Q16` |
| `nextEventMatchingMask:untilDate:inMode:dequeue:` | − | `@44@0:8Q16@24@32B40` |

### NSWindow

| selector | kind | encoding | struct risk |
| --- | --- | --- | --- |
| `alloc` | + | `@16@0:8` | — |
| `init` | − | `@16@0:8` | — (inherited `NSObject`) |
| `initWithContentRect:styleMask:backing:defer:` | − | `@68@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16Q48Q56B64` | **CGRect in** |
| `makeKeyAndOrderFront:` | − | `v24@0:8@16` | — |
| `orderOut:` | − | `v24@0:8@16` | — |
| `setTitle:` | − | `v24@0:8@16` | — |
| `title` | − | `@16@0:8` | — |
| `contentView` | − | `@16@0:8` | — |
| `setContentView:` | − | `v24@0:8@16` | — |
| `setDelegate:` | − | `v24@0:8@16` | — |
| `titlebarAppearsTransparent` | − | `B16@0:8` | — |
| `setTitlebarAppearsTransparent:` | − | `v20@0:8B16` | — |
| `styleMask` / `setStyleMask:` | − | `Q16@0:8` / `v24@0:8Q16` | — |
| `setBackgroundColor:` | − | `v24@0:8@16` | — |
| `setOpaque:` | − | `v20@0:8B16` | — |
| `setHasShadow:` | − | `v20@0:8B16` | — |
| `setLevel:` | − | `v24@0:8q16` | — |
| `setReleasedWhenClosed:` | − | `v20@0:8B16` | — |
| `center` | − | `v16@0:8` | — |
| `close` | − | `v16@0:8` | — |
| `isVisible` | − | `B16@0:8` | — |
| `screen` | − | `@16@0:8` | — |
| `setMovableByWindowBackground:` | − | `v20@0:8B16` | — |
| `setAcceptsMouseMovedEvents:` | − | `v20@0:8B16` | — |
| `setCollectionBehavior:` | − | `v24@0:8Q16` | — |
| `addChildWindow:ordered:` | − | `v32@0:8@16q24` | — |
| `setToolbar:` / `setRepresentedURL:` / `setInitialFirstResponder:` | − | `v24@0:8@16` | — |
| `setFrameFromString:` | − | `v24@0:8@16` | — |
| `setFrame:display:` | − | `v52@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16B48` | **CGRect in** |
| `setFrame:display:animate:` | − | `v56@0:8{CGRect=…}16B48B52` | **CGRect in** |
| `setContentSize:` | − | `v32@0:8{CGSize=dd}16` | **CGSize in** |
| `frame` | − | `{CGRect={CGPoint=dd}{CGSize=dd}}16@0:8` | **CGRect out** |
| `contentRectForFrameRect:` | − | `{CGRect=…}48@0:8{CGRect=…}16` | **CGRect in and out** |
| `frameRectForContentRect:` | − | `{CGRect=…}48@0:8{CGRect=…}16` | **CGRect in and out** |
| `constrainFrameRect:toScreen:` | − | `{CGRect=…}56@0:8{CGRect=…}16@48` | **CGRect in and out** |
| `animationResizeTime:` | − | `d48@0:8{CGRect=…}16` | **CGRect in** |
| `minSize` | − | `{CGSize=dd}16@0:8` | **CGSize out** |
| `setMinSize:` | − | `v32@0:8{CGSize=dd}16` | **CGSize in** |

### NSView

| selector | kind | encoding | struct risk |
| --- | --- | --- | --- |
| `initWithFrame:` | − | `@48@0:8{CGRect=…}16` | **CGRect in** |
| `setTranslatesAutoresizingMaskIntoConstraints:` | − | `v20@0:8B16` | — |
| `translatesAutoresizingMaskIntoConstraints` | − | `B16@0:8` | — |
| `addSubview:` | − | `v24@0:8@16` | — |
| `setNeedsLayout:` | − | `v20@0:8B16` | — |
| `layoutSubtreeIfNeeded` | − | `v16@0:8` | — |
| `setAutoresizingMask:` | − | `v24@0:8Q16` | — |
| `setWantsLayer:` | − | `v20@0:8B16` | — |
| `window` / `superview` | − | `@16@0:8` | — |
| `setFrame:` | − | `v48@0:8{CGRect=…}16` | **CGRect in** |
| `setFrameSize:` | − | `v32@0:8{CGSize=dd}16` | **CGSize in** |
| `setFrameOrigin:` | − | `v32@0:8{CGPoint=dd}16` | **CGPoint in** |
| `frame` / `bounds` | − | `{CGRect=…}16@0:8` | **CGRect out** |
| `convertRect:toView:` | − | `{CGRect=…}56@0:8{CGRect=…}16@48` | **CGRect in and out** |
| `convertPoint:toView:` | − | `{CGPoint=dd}40@0:8{CGPoint=dd}16@32` | **CGPoint in and out** |

Note: the real name is `convertRect:fromView:` / `convertRect:toView:`, not
`convertRectFromView:` (which returned no method at all). Header:
`NSView.h:153-154`.

### WKWebView

| selector | kind | encoding | struct risk |
| --- | --- | --- | --- |
| `alloc` | + | `@16@0:8` | — |
| `init` | − | `@16@0:8` | — |
| `initWithFrame:configuration:` | − | `@56@0:8{CGRect=…}16@48` | **CGRect in** |
| `loadRequest:` | − | `@24@0:8@16` | — |
| `loadHTMLString:baseURL:` | − | `@32@0:8@16@24` | — |
| `loadFileURL:allowingReadAccessToURL:` | − | `@32@0:8@16@24` | — |
| `setNavigationDelegate:` | − | `v24@0:8@16` | — |
| `navigationDelegate` | − | `@16@0:8` | — |
| `setUIDelegate:` | − | `v24@0:8@16` | — |
| `evaluateJavaScript:completionHandler:` | − | `v32@0:8@16@?24` | block arg (`@?`) |
| `configuration` | − | `@16@0:8` | — |
| `setAllowsBackForwardNavigationGestures:` | − | `v20@0:8B16` | — |
| `setInspectable:` | − | `v20@0:8B16` | — |
| `setCustomUserAgent:` | − | `v24@0:8@16` | — |
| `title` / `URL` | − | `@16@0:8` | — |
| `isLoading` | − | `B16@0:8` | — |
| `stopLoading` | − | `v16@0:8` | — |
| `reload` / `goBack` / `goForward` | − | `@16@0:8` | — |
| `setMagnification:` | − | `v24@0:8d16` | — |
| `setPageZoom:` | − | `v24@0:8d16` | — |
| `takeSnapshotWithConfiguration:completionHandler:` | − | `v32@0:8@16@?24` | block arg |

`setFindInteractionEnabled:` returned **no method** on this SDK; the header
(`WKWebView.h:670`) marks the property `API_AVAILABLE(ios(16.0))` with no macOS
availability, so it is iOS-only here.

### WKWebViewConfiguration and friends

| selector | kind | encoding |
| --- | --- | --- |
| `WKWebViewConfiguration alloc` | + | `@16@0:8` |
| `WKWebViewConfiguration init` | − | `@16@0:8` |
| `setPreferences:` | − | `v24@0:8@16` |
| `preferences` | − | `@16@0:8` |
| `setProcessPool:` | − | `v24@0:8@16` |
| `setWebsiteDataStore:` | − | `v24@0:8@16` |
| `setUserContentController:` | − | `v24@0:8@16` |
| `userContentController` | − | `@16@0:8` |
| `setSuppressesIncrementalRendering:` | − | `v20@0:8B16` |
| `setMediaTypesRequiringUserActionForPlayback:` | − | `v24@0:8Q16` |
| `setDefaultWebpagePreferences:` | − | `v24@0:8@16` |
| `defaultWebpagePreferences` | − | `@16@0:8` |
| `WKPreferences init` | − | `@16@0:8` |
| `WKProcessPool init` | − | `@16@0:8` |
| `WKUserContentController init` | − | `@16@0:8` |
| `WKUserContentController addUserScript:` | − | `v24@0:8@16` |
| `addScriptMessageHandler:name:` | − | `v32@0:8@16@24` |
| `addScriptMessageHandler:contentWorld:name:` | − | `v40@0:8@16@24@32` |
| `WKUserScript initWithSource:injectionTime:forMainFrameOnly:` | − | `@36@0:8@16q24B32` |
| `WKWebsiteDataStore defaultDataStore` | + | `@16@0:8` |
| `WKWebsiteDataStore nonPersistentDataStore` | + | `@16@0:8` |
| `httpCookieStore` | − | `@16@0:8` |

`setAllowsInlineMediaPlayback:` returned no method: the header
(`WKWebViewConfiguration.h:175`) declares it without macOS availability, so it
is iOS-only.

### NSURL / NSURLRequest / NSMutableURLRequest

| selector | kind | encoding |
| --- | --- | --- |
| `NSURL URLWithString:` | + | `@24@0:8@16` |
| `URLWithString:relativeToURL:` | + | `@32@0:8@16@24` |
| `fileURLWithPath:` | + | `@24@0:8@16` |
| `fileURLWithPath:isDirectory:` | + | `@28@0:8@16B24` |
| `absoluteString` | − | `@16@0:8` |
| `isFileURL` | − | `B16@0:8` |
| `NSURLRequest requestWithURL:` | + | `@24@0:8@16` |
| `requestWithURL:cachePolicy:timeoutInterval:` | + | `@40@0:8@16Q24d32` |
| `NSMutableURLRequest setHTTPMethod:` | − | `v24@0:8@16` |
| `setValue:forHTTPHeaderField:` | − | `v32@0:8@16@24` |
| `setCachePolicy:` / `setTimeoutInterval:` / `setURL:` | − | `v24@0:8Q16` / `v24@0:8d16` / `v24@0:8@16` |

### NSLayoutConstraint

| selector | kind | encoding |
| --- | --- | --- |
| `constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:` | + | `@72@0:8@16q24q32@40q48d56d64` |
| `constraintWithItem:attribute:relatedBy:constant:` | + | `@48@0:8@16q24q32d40` |
| `setConstant:` | − | `v24@0:8d16` |
| `setActive:` | − | `v20@0:8B16` |
| `activateConstraints:` / `deactivateConstraints:` | + | `v24@0:8@16` |
| `constraintsWithVisualFormat:options:metrics:views:` | + | `@48@0:8@16Q24@32@40` |

Seven arguments, all scalars or objects. **No struct.** This is the whole reason
Auto Layout is the struct-free layout path.

### NSMenu / NSMenuItem / NSStatusBar / NSStatusItem

| selector | kind | encoding |
| --- | --- | --- |
| `NSMenu alloc` | + | `@16@0:8` |
| `initWithTitle:` | − | `@24@0:8@16` |
| `addItem:` | − | `v24@0:8@16` |
| `addItemWithTitle:action:keyEquivalent:` | − | `@40@0:8@16:24@32` |
| `setTitle:` | − | `v24@0:8@16` |
| `setDelegate:` | − | `v24@0:8@16` |
| `setAutoenablesItems:` | − | `v20@0:8B16` |
| `removeAllItems` | − | `v16@0:8` |
| `size` | − | `{CGSize=dd}16@0:8` |
| `NSMenuItem initWithTitle:action:keyEquivalent:` | − | `@40@0:8@16:24@32` |
| `setTarget:` / `setAction:` | − | `v24@0:8@16` / `v24@0:8:16` |
| `setKeyEquivalent:` / `setSubmenu:` | − | `v24@0:8@16` |
| `setEnabled:` | − | `v20@0:8B16` |
| `setRepresentedObject:` | − | `v24@0:8@16` |
| `setIndentationLevel:` | − | `v24@0:8q16` |
| `NSStatusBar systemStatusBar` | + | `@16@0:8` |
| `statusItemWithLength:` | − | `@24@0:8d16` |
| `vertical` (getter `isVertical`) | − | `B16@0:8` |
| `thickness` | − | `d16@0:8` |
| `NSStatusItem setMenu:` | − | `v24@0:8@16` |
| `button` | − | `@16@0:8` |
| `setLength:` | − | `v24@0:8d16` |
| `setHighlightMode:` / `setVisible:` | − | `v20@0:8B16` |
| `setAutosaveName:` / `setToolTip:` | − | `v24@0:8@16` |

`statusItemWithLength:`, `thickness` and `isVertical` are **instance** methods —
send them to `[[NSStatusBar systemStatusBar] …]`, never to the class object.
`NSMenu -items` does not exist: the property is `itemArray` (header
`NSMenu.h:115`).

### The rest (verified, no struct except where noted)

| selector | kind | encoding |
| --- | --- | --- |
| `NSScreen mainScreen` / `screens` | + | `@16@0:8` |
| `NSScreen frame` / `visibleFrame` | − | `{CGRect=…}16@0:8` |
| `NSScreen backingScaleFactor` | − | `d16@0:8` |
| `NSWorkspace sharedWorkspace` | + | `@16@0:8` |
| `NSWorkspace openURL:` | − | `B24@0:8@16` |
| `NSBundle mainBundle` | + | `@16@0:8` |
| `NSBundle bundleIdentifier` | − | `@16@0:8` |
| `NSBundle infoDictionary` / `objectForInfoDictionaryKey:` | − | `@16@0:8` / `@24@0:8@16` |
| `NSProcessInfo processInfo` | + | `@16@0:8` |
| `beginActivityWithOptions:reason:` | − | `@32@0:8Q16@24` |
| `disableSuddenTermination` | − | `v16@0:8` |
| `NSPasteboard generalPasteboard` | + | `@16@0:8` |
| `clearContents` / `setString:forType:` / `stringForType:` | − | `q16@0:8` / `B32@0:8@16@24` / `@24@0:8@16` |
| `NSColor colorWithCalibratedRed:green:blue:alpha:` | + | `@48@0:8d16d24d32d40` |
| `colorWithWhite:alpha:` | + | `@32@0:8d16d24` |
| `clearColor` / `setFill` | +/− | `@16@0:8` / `v16@0:8` |
| `NSFont systemFontOfSize:` | + | `@24@0:8d16` |
| `fontWithName:size:` | + | `@32@0:8@16d24` |
| `NSImage imageNamed:` | + | `@24@0:8@16` |
| `NSImage size` | − | `{CGSize=dd}16@0:8` |
| `NSValue valueWithPointer:` | + | `@24@0:8r^v16` |
| `NSValue pointerValue` | − | `^v16@0:8` |
| `NSAutoreleasePool alloc` / `drain` | +/− | `@16@0:8` / `v16@0:8` |

Not present on this SDK: `NSWorkspace setFrontProcessApplication:`.

---

## 3. Encoding character map

| char | C type | size (arm64) | libffi |
| --- | --- | --- | --- |
| `c` | `char`, `BOOL` (signed) | 1 | `ffi_type_sint8` |
| `i` | `int` | 4 | `ffi_type_sint32` |
| `s` | `short` | 2 | `ffi_type_sint16` |
| `l` | `long` | 8 | `ffi_type_slong` |
| `q` | `long long` | 8 | `ffi_type_sint64` |
| `C` | `unsigned char` | 1 | `ffi_type_uint8` |
| `I` | `unsigned int` | 4 | `ffi_type_uint32` |
| `S` | `unsigned short` | 2 | `ffi_type_uint16` |
| `L` | `unsigned long` | 8 | `ffi_type_ulong` |
| `Q` | `unsigned long long` | 8 | `ffi_type_uint64` |
| `f` | `float` | 4 | `ffi_type_float` |
| `d` | `double` / `CGFloat` | 8 | `ffi_type_double` |
| `D` | `long double` | 16 | `ffi_type_longdouble` |
| `B` | `_Bool` / C++ `bool` | 1 | `ffi_type_uint8` |
| `v` | `void` | 0 | `ffi_type_void` |
| `*` | `char *` | 8 | `ffi_type_pointer` |
| `@` | `id` | 8 | `ffi_type_pointer` |
| `#` | `Class` | 8 | `ffi_type_pointer` |
| `:` | `SEL` | 8 | `ffi_type_pointer` |
| `^` | pointer to anything (`^v`, `^i`) | 8 | `ffi_type_pointer` |
| `?` | unknown; `@?` = block, `^?` = function pointer | 8 | `ffi_type_pointer` |
| `{…}` | struct | — | **constructed `ffi_type_struct`** |
| `[…]` | array | — | **constructed `ffi_type_struct`** of N elements |
| `(…)` | union | — | **constructed `ffi_type_struct`** (all fields at offset 0) |
| `b` | bitfield (`b3`) | — | no libffi equivalent; treat as the underlying int |
| `r` `n` `N` `O` `P` `R` `j` | qualifiers (`const`, `in`, `inout`, `bycopy`, `byref`, `oneway`, `_Complex`) | — | `r`/`n`/… are ignored by libffi; `j` needs `ffi_type_complex_float` / `ffi_type_complex_double` (libffi ≥ 3.4) |

### How a struct is laid out inside the braces

- Grammar: `{Name=field1field2…}` — fields are **concatenated with no
  separator**, so a struct is a recursive-descent parse over the same character
  table. `{CGRect={CGPoint=dd}{CGSize=dd}}` is two nested structs, not a flat
  list of four doubles.
- The name after `{` is cosmetic; libffi ignores it.
- An unnamed field is written `?`: `{?=dd}`.
- Offsets are implicit — fields are sequential, each aligned to its natural
  boundary. The encoding carries **no padding bytes**, so the parser must apply
  the platform alignment rules itself; libffi does this from the field list.
- Nesting is arbitrary depth; `{CGRect={CGPoint=dd}{CGSize=dd}}` = 32 bytes =
  4 × `double`.
- Arrays are `[16c]` (16 bytes) and nest: `[2{CGPoint=dd}]`.
- Pointers inside a struct are still `^`, e.g. `{?=^v}`.

Everything in crust's reach is a flat struct of doubles (`CGPoint`, `CGSize`,
`CGRect`, `NSRange` = `{?=QQ}` on 64-bit). No bitfields, no unions, no nested
arrays appear in any encoding measured here.

### What this means for libffi

- `ffi_type_*` directly: every scalar, pointer, `id`, `SEL`, `Class`, block.
- Constructed `ffi_type_struct`: every `{…}`, `[…]`, `(…)`.
- A struct **return** needs `ffi_prep_cif` with `rtype` = that constructed
  type; libffi then handles the arm64 x8 hidden-pointer return itself.
- A struct **argument** needs the same constructed type in `atypes`; libffi
  applies the >16-byte indirect rule.

libffi has no notion of `id`/`SEL`/`Class`; they are all `ffi_type_pointer`,
so nothing is lost.

---

## 4. Struct risk, and whether it can be avoided

Every selector in the inventory whose encoding contains `{`, `[`, `(`, `^` or a
struct anywhere in the string:

| selector | struct in | struct out | avoidable? |
| --- | --- | --- | --- |
| `NSWindow initWithContentRect:styleMask:backing:defer:` | CGRect | — | yes — `[[NSWindow alloc] init]` exists in the runtime (`@16@0:8`) |
| `NSWindow setFrame:display:` / `…:animate:` | CGRect | — | yes — Auto Layout |
| `NSWindow setContentSize:` | CGSize | — | yes — Auto Layout |
| `NSWindow setMinSize:` | CGSize | — | yes — Auto Layout (`constraintWithItem:attribute:relatedBy:constant:`) |
| `NSWindow frame` | — | CGRect | **no** — read it via KVC + `NSValue` instead (see below) |
| `NSWindow minSize` | — | CGSize | no — same workaround |
| `NSWindow contentRectForFrameRect:` | CGRect | CGRect | yes — never needed |
| `NSWindow frameRectForContentRect:` | CGRect | CGRect | yes — never needed |
| `NSWindow constrainFrameRect:toScreen:` | CGRect | CGRect | yes — never needed |
| `NSWindow animationResizeTime:` | CGRect | — | yes — never needed |
| `NSView initWithFrame:` | CGRect | — | yes — `[[WKWebView alloc] init]` exists |
| `NSView setFrame:` / `setFrameSize:` / `setFrameOrigin:` | CGRect / CGSize / CGPoint | — | yes — Auto Layout |
| `NSView frame` / `bounds` | — | CGRect | **no** — KVC workaround |
| `NSView convertRect:toView:` | CGRect | CGRect | yes — never needed |
| `NSView convertPoint:toView:` | CGPoint | CGPoint | yes — never needed |
| `WKWebView initWithFrame:configuration:` | CGRect | — | yes — `[[WKWebView alloc] init]` exists (`@16@0:8`) |
| `NSMenu size` | — | CGSize | yes — never needed |
| `NSScreen frame` / `visibleFrame` | — | CGRect | **no** — KVC workaround, or read `backingScaleFactor` and stay relative |
| `NSImage size` | — | CGSize | yes — never needed for a webview |

### Can a struct argument be delivered anyway? Measured: no.

The arm64 rule is that a composite **larger than 16 bytes** is copied by the
caller and replaced by a pointer to the copy, so in principle a `void *`
prototype should be ABI-correct for `CGRect`. That was tested directly, and it
does not work under bun 1.4.4:

```
bun run probe/abi-bufcheck2.ts
  · JS DataView readback: 1,2,900,640
  · bytes 16..24: 64,140,32,0,0,0,0,0          # 900.0, so the buffer is right
  · CGRectGetWidth -> 1.354263907692e-311      # expect 900
  · CGRectGetHeight -> 2.8e-322                # expect 640
```

`CGRectGetWidth` was called with the buffer as a `ptr` argument. The bytes are
correct on the JavaScript side; the C side reads a different address. The same
holds for `ArrayBuffer`, `TypedArray.buffer`, `DataView`, `Buffer` and an
explicit `ptr(...)` wrapper (`probe/abi-ptr.ts`), so this is not a matter of
which JS type is passed.

A second, separate bun defect sits underneath it and must be known by anyone
writing a probe here:

```
bun run probe/bufcheck.ts
  Float64Array readback: [ 1, 2, 900, 640 ]
  DataView readback: 3.03865e-319 3.16e-322 1.0538697e-317 1.6727e-319
```

Writes through a `Float64Array` view are **not visible** through a `DataView`
view of the same `ArrayBuffer`. Build any buffer for the FFI with `DataView`
only.

Consequence for crust: **struct arguments are not available and struct returns
are not available.** Every selector in the table marked avoidable must be
replaced, not worked around.

### The workaround for the unavoidable ones: KVC boxes, NSValue unwraps

A struct return can be read without libffi by asking for it as an object:

```
win = [[NSWindow alloc] initWithContentRect:…]      # or any window
box = [win valueForKey:@"frame"]                    # NSValue, encodes as {CGRect=…}
desc = [box description]                            # "NSRect: {{0, 0}, {900, 640}}"
```

Measured: `valueForKey:@"frame"` returns an `NSValue` whose `objCType` is
`{CGRect={CGPoint=dd}{CGSize=dd}}` (`probe/abi-one.ts kvc-nsstring`), and
`-description` renders the numbers as text. That is a struct read with no
struct ever crossing the FFI boundary — it needs the key as an `NSString`, and
`-description` as the exit.

---

## 5. Aborts: exact selector, exact receiver

Every abort below is required to be recorded with the rule it forces.

| # | receiver | selector sent | what actually exists | outcome |
| --- | --- | --- | --- | --- |
| 1 | `NSStatusBar` **class object** | `+[NSStatusBar thickness]` | `-[NSStatusBar thickness]` (`d16@0:8`), instance only | `SIGABRT` — `+[NSObject(NSObject) doesNotRecognizeSelector:]` |
| 2 | `NSLayoutConstraint` class | `+[NSLayoutConstraint constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:]` with `item = nil`, `toItem = nil` | exists (`@72@0:8@16q24q32@40q48d56d64`) | abort — AppKit raises on a nil item, not an unrecognized selector |
| 3 | `NSWindow` instance | `-[NSWindow setContentSize:]` with a pointer where `NSSize` is expected | exists (`v32@0:8{CGSize=dd}16`) | abort — the callee reads garbage in `d0/d1` |
| 4 | `NSWindow` instance (alloc only, never initialized) | `-[NSObject valueForKey:@"frame"]` | exists (`@24@0:8@16`) | trap inside AppKit — an uninitialized `NSWindow` cannot answer KVC |

Row 1 is the one that matters most for crust: `class_getClassMethod` reports
`cls=n` for it, but the *first* version of the probe mis-read the columns and
sent it anyway. `class_getClassMethod` also reports `+init` and `+valueForKey:`
as present on every class, because the metaclass chain falls back to the root
class — so it is not a safe existence test on its own.

**Rule this forces on crust:** never send a selector without checking
`class_getInstanceMethod` (or `respondsToSelector:`) first, and print the check
beside the call. An uncaught Objective-C exception terminates the process with
no JavaScript error — there is no `try`/`catch` above `bun:ffi`.

---

## 6. ATS / Info.plist

The design's claim — *"`WKWebView` will refuse plain `http://[IP_ADDRESS]`
unless `Info.plist` carries `NSAllowsLocalNetworking`"* — is **not right as
stated**. Apple's documentation for the two keys says:

- `NSAllowsLocalNetworking` (macOS 10.12+) "controls whether App Transport
  Security (ATS) allows your app to connect to unqualified domains, `.local`
  domains, and IP addresses using IPv4 or IPv6." Default `NO`.
- macOS 10.12 through macOS 13 allowed all three by default; **macOS 14 ATS no
  longer allows connections to IP addresses by default**, and Apple says to add
  individual IP addresses or CIDR ranges to `NSExceptionDomains`.
- `NSAllowsArbitraryLoadsInWebContent` (macOS 10.12+) is the key that targets
  `WKWebView`: "Set this key's value to `YES` to exempt your app's `WKWebView`
  instances from App Transport Security restrictions without affecting your
  `NSURLSession` connections."

So the correct set for crust is:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoadsInWebContent</key>
  <true/>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

- `NSAllowsArbitraryLoadsInWebContent` covers the page's own subresources and
  `fetch`/XHR from the web content, which is what a webview app actually loads.
- `NSAllowsLocalNetworking` covers `URLSession` use in Bun and unqualified host
  names.
- Prefer `http://localhost:<port>` over `http://[IP_ADDRESS]:<port>`: the
  unqualified name is covered on every macOS version, while a bare IP address
  is the case macOS 14 tightened.

Marked: the exact ATS behaviour is **not verified at runtime here** (a webview
load needs a run loop and a window, which is M0's job). The key semantics above
are from Apple's documentation, fetched today.

## 7. Does WKWebView need a bundle identifier?

Partly, and not the way the design says.

- **Measured:** `[[NSBundle mainBundle] bundleIdentifier]` in a bare bun
  process returns `null` (`probe/bundleid.ts`).
- **Measured:** `[[WKWebView alloc] init]` returns a valid object in that same
  bundle-less process (`probe/abi-mini.ts wk-init-only` →
  `webview = 4444023040`). So the strong form of the claim — that a webview
  cannot exist without a bundle identity — is false.
- **Not measured:** whether such a webview *renders*, and how WebKit's
  website-data store keys itself. WebKit's storage is keyed off the app's
  bundle identifier, which is the reason to ship one, and is the widely
  reported behaviour; treat it as untested here.

Keep `CFBundleIdentifier` in the generated `Info.plist`. It costs nothing and
avoids an unverified WebKit path.

---

## 8. The minimal window selector set

Shortest ordered sequence that produces a window with a webview, with **no
struct argument and no struct return anywhere in it**.

```
dlopen  /usr/lib/libobjc.A.dylib
dlopen  AppKit, Foundation, WebKit           # WebKit's dlopen may throw; ignore

 1.  pool  = [[NSAutoreleasePool alloc] init]
 2.  app   = [NSApplication sharedApplication]
 3.  [app setActivationPolicy:1]             # .accessory — no dock icon, no bundle needed
 4.  [app finishLaunching]
 5.  win   = [[NSWindow alloc] init]                     # @16@0:8, struct-free
 6.  [win setTitle:@"crust"]                             # v24@0:8@16
 7.  [win setReleasedWhenClosed:0]                       # v20@0:8B16
 8.  cfg   = [[WKWebViewConfiguration alloc] init]       # @16@0:8
 9.  web   = [[WKWebView alloc] init]                    # @16@0:8, struct-free
10.  [win setContentView:web]                            # v24@0:8@16
11.  [web setNavigationDelegate:delegate]                # v24@0:8@16 (nil, or a runtime class)
12.  [web setTranslatesAutoresizingMaskIntoConstraints:0]         # v20@0:8B16
13.  add  width/height constraints on web                # NSLayoutConstraint, 7 scalars
14.  [win makeKeyAndOrderFront:nil]                      # v24@0:8@16
15.  url  = [NSURL URLWithString:@"http://localhost:PORT/"]
16.  req  = [NSURLRequest requestWithURL:url]
17.  [web loadRequest:req]
18.  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.004, true)   # repeat from JS
```

Notes on individual steps:

- Step 5 is the one that replaces `initWithContentRect:`. `[[NSWindow alloc]
  init]` **does exist** in the runtime (inherited from `NSObject`, encoding
  `@16@0:8`) and returns a live window with `isVisible == false`
  (`probe/abi-mini.ts init-window`). What is **not** verified is its size
  behaviour; the window's frame must come from step 13's constraints, and that
  needs a layout pass, which only a run loop provides.
- Step 9 replaces `initWithFrame:configuration:`. `[[WKWebView alloc] init]`
  returns a valid object (measured). The view's geometry comes from the
  constraints.
- Step 13 is the reason `NSLayoutConstraint` matters: seven scalar/object
  arguments, no struct, and Auto Layout resizes the window to satisfy required
  constraints on the content view.
- Step 11 needs a runtime-created delegate class for real callbacks
  (`windowShouldClose:`, `webView:decidePolicyForNavigationAction:…`). That is
  the least-tested part of the design and is M0's second risk.
- Step 18 is the pump; `[NSApp run]` must never be sent.

Struct-free is therefore achievable for the whole path, but only if **no
frame-based sizing is used at all**. The moment crust wants a 1100×760 window
created directly, it needs either `initWithContentRect:` (CGRect, unavailable)
or Auto Layout (available).

---

## 9. Probe files

| file | what it is |
| --- | --- |
| `probe/encoding-probe.ts` | 205 selectors, runtime encodings, superclass chains — writes `encoding.txt` |
| `probe/encoding.txt` | its output, the raw evidence for section 2 |
| `probe/abi-verify.ts` | existence check before any send (the crust rule) |
| `probe/abi-probe.ts` | `CFunction` prototype builder, CGRect/NSSize argument tests |
| `probe/abi-mini.ts`, `abi-one.ts`, `abi-frame.ts` | per-call bisect harness (one claim per run) |
| `probe/abi-cg.ts`, `abi-bufcheck.ts`, `abi-bufcheck2.ts`, `abi-ptr.ts`, `bufcheck.ts` | the `ptr`-argument failure and the `Float64Array`/`DataView` defect |
| `probe/bundleid.ts` | `bundleIdentifier` is null without a bundle |
| `probe/smoke*.ts`, `apitest*.ts` | `dlopen` / `CFunction` mechanics |

## 10. Claims from the brief that turned out wrong

1. *"Both reachable by `dlopen`ing `/usr/lib/libobjc.A.dylib`"* — true, and the
   recommended path. No correction needed.
2. *"`WKWebView` will refuse plain `http://[IP_ADDRESS]` unless `Info.plist`
   carries `NSAllowsLocalNetworking`"* — wrong as stated: the webview key is
   `NSAllowsArbitraryLoadsInWebContent`, and on macOS 14+ a bare IP address is
   the case `NSAllowsLocalNetworking` does not reliably cover. Section 6.
3. *"`CFBundleIdentifier` is required — `WKWebView` keys its storage … off the
   bundle identity, and a binary without one behaves badly"* — the runtime does
   construct a `WKWebView` with `bundleIdentifier == null`. The storage-keying
   claim is plausible but unverified here. Section 7.
4. *"Struct arguments and struct returns are where a hand-declared ladder
   breaks … libffi marshals them, a fixed prototype does not"* — directionally
   right, and worse than described under bun: even the >16-byte indirect-pointer
   route fails, because bun does not pass a JS buffer's data pointer to a native
   `ptr` parameter. Section 4.