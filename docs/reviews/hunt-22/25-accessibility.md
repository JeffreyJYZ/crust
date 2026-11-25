# Hunt 22 — lane 25: accessibility, menus and the AX surfaces

Read-only source inspection. No app launched, no focus taken, no test run, no source file changed.
Scope: `src/plugins/accessibility*.ts`, `src/plugins/menu*.ts`, `src/bridge/client/a11y-page.ts`,
`src/platform/darwin/accessibility*.ts`, `src/platform/darwin/menu*.ts`,
`src/platform/darwin/status-bar-item.ts`, their C units under `src/platform/darwin/shim/`, and the
public docs pages that describe them. Every claim below is `read` unless stated otherwise.

## MEDIUM — `crust_ax_focus` reports focus moved without checking whether any AX attribute was set

- where: `src/platform/darwin/shim/106_accessibility_page.c:153-194`; adapter
  `src/platform/darwin/accessibility.ts:145-154`; handler `src/plugins/accessibility-page.ts:140-159`;
  docs `site/app/docs/guides/accessibility/page.mdx:47`
- mechanism: `crust_ax_focus` resolves a matching window element, then issues three
  `AXUIElementSetAttributeValue` calls at `:185`, `:186`, `:187` (`AXFocusedWindow` on the app,
  `AXFocused` and `AXMain` on the target). Every return value is discarded. Two
  `NSAccessibilityPostNotificationWithUserInfo` calls follow at `:188-191`, then the function returns
  `1` unconditionally at `:194`. `AXUIElementSetAttributeValue` returns an `AXError` (`kAXErrorSuccess`
  is 0); a refused set is a normal outcome, not an exception. The adapter maps `1` to
  `{ focused: true, reason: "AXFocusedWindow and AXFocused were set and posted" }` and the handler
  relays `{ ok: true, focused: true }`. So the success answer asserts the sets happened even when all
  three were refused. The docs promise the same: "Sets `AXFocusedWindow` and `AXFocused`, then posts …
  the two posts are what makes it move." The posts do not make a refused set succeed.
- reachable by: a page with the `accessibility.focus` grant invoking
  `crust.accessibility.focus({ label })` while the target window cannot take assistive focus — a panel
  or window on another Space, or an untrusted process (the guide states the app is untrusted by
  default at `:96-97`). The AX element still matches by `windowNumber`, so a match is found, the sets
  are refused, and the page is told focus moved while VoiceOver stayed where it was. No test covers
  the succeeded-set branch: `accessibility-page.test.ts:42-46` only exercises the no-window case.
- smallest fix: check each `AXUIElementSetAttributeValue` result; return 0 (or a distinct code) when
  none of the three succeeded, and only then post the notifications. Have the adapter's `reason`
  state which attributes were actually applied rather than naming all three.

## MEDIUM — `menu.read` silently truncates submenus past the first level, and the result cannot express it

- where: `src/platform/darwin/shim/98_menu_read.c:47-63`; tree assembly `src/plugins/menu-read.ts:60-76`;
  type `src/plugins/menu-read.ts:16-23`; docs `site/app/docs/reference/api-ui/page.mdx:55`
- mechanism: `menu_api_read` walks the main menu's root rows and, for each root, exactly one level of
  that root's submenu (`:51-61`). It never descends into a child's own submenu. The file's own header
  says "One level only: a deeper submenu is not walked, and a caller sees `hasSubmenu`." `menuTree`
  then rebuilds a tree from those flat rows, so a grandchild row simply has no entry. The only signal
  is `hasSubmenu: true` on the parent with no `children` array — which is indistinguishable from a
  submenu AppKit holds as empty. The docs promise `read` "returns the live bar as AppKit holds it" with
  per-row `children?`, with no depth caveat. A prior "checked and clean" claim
  (`docs/reviews/hunt-21/13-shell-chrome.md:62`) says the read caps "truncate visibly rather than
  silently"; that holds for the 64-row and 256-byte caps, not for this depth limit, which is not a cap
  and carries no marker.
- reachable by: any spec with nested submenus — `planRow` recurses without a TS depth limit
  (`src/plugins/menu-spec.ts:161-164`) and the C builder allows depth 8 (`98_menu_api.c:28,145`). A
  caller building `File → Recent → Today → item` and reading back gets `File` with child `Recent`,
  `Recent.hasSubmenu === true`, and no `children`, so `menu.read` cannot verify two thirds of the menu
  it installed. The readback test (`src/platform/darwin/menu-readback.test.ts:20-39`) builds a single
  level, so the suite cannot catch this.
- smallest fix: either walk all levels in `menu_api_read` (bounded by the existing row cap) and keep
  the `parent` index scheme, or add an explicit `depthTruncated: true` field to `MenuReadResult` and
  document it, so a caller can tell "empty submenu" from "not walked".

## LOW — `accessibility.trusted` cannot distinguish "AX not granted" from "native unit unavailable"

- where: `src/platform/darwin/accessibility.ts:107-111`; handler `src/plugins/accessibility-trust.ts:67-74`;
  docs `site/app/docs/guides/accessibility/page.mdx:66-69`
- mechanism: `darwinAccessibilityAdapter().trusted()` calls `compiled()`; when the C unit cannot be
  built it returns `false` (`:109`), the same value `AXIsProcessTrusted()` returns when trust is
  genuinely absent. No reason travels with it — `crust_ax_reason` is not read on this path — and the
  plugin answers `{ ok: true, trusted: false }`. `elementCount` on the same adapter reports a compile
  failure as a typed `refused` with a reason (`accessibility.ts:119-121`), so the two commands disagree
  about whether the native half exists. The guide tells callers to use `trusted` first "so the app can
  explain itself instead of failing opaquely" (`:69`); with this conflation the app can only give the
  wrong explanation — that the user must grant Accessibility permission. The same class of defect was
  filed for `dock.badgeLabel` (`docs/reviews/hunt-21/13-shell-chrome.md:56-58`) but was never applied to
  the trust probe.
- reachable by: any machine where the accessibility C unit fails to compile (a TinyCC failure or a
  missing ApplicationServices link), while the plugin is still registered unconditionally
  (`src/runtime-plugins.ts:181`). `crust.accessibility.trusted()` answers `false`; an app following the
  docs sends the person into System Settings to grant a permission that is already granted.
- smallest fix: surface `compiled()`'s failure string in the adapter result, and have `trusted`
  answer a typed failure (or a `reason` field) when the native read never ran; keep `false` only for
  a real `AXIsProcessTrusted()` answer.

## LOW — Unknown-label `focus` drifted from its documented shape, and a no-windows state is mislabelled `bad-request`

- where: `src/plugins/accessibility-page.ts:146-158`; C reason `106_accessibility_page.c:153-155`;
  docs `site/app/docs/guides/accessibility/page.mdx:49`
- mechanism: the handler now classifies any reason matching `/no (?:AX )?window matched/i` as
  `bad-request` (`:152-155`) — a typed failure with `message`, not a success. The guide still promises
  "Unknown labels answer `focused: false` with the name in `reason`, never a throw." `FocusResult` does
  carry a `reason`, but no `FocusResult` is returned on that branch at all. Separately, the adapter
  emits the same `no AX window matched …` reason both for a bad label and for `ax_window` finding no
  windows (`:154-155`), e.g. when the app is inactive and no window is on the active Space. That is an
  environment state the caller cannot fix by changing the label, yet it is reported as the caller's
  `bad-request`.
- reachable by: `crust.accessibility.focus({ label: "main" })` with no matching window. A page written
  against the docs branches on `ok === true && focused === false` and never sees the failure. A page
  that does branch on `ok === false` is told its request was malformed when the real cause was an
  inactive app.
- smallest fix: update the guide to the `{ ok: false, code: "bad-request" }` shape, and have the C
  adapter distinguish "no window matched the label" from "no windows at all" so the handler can keep
  `bad-request` for the former and use a state/refusal code for the latter.

## Checked and deliberately not re-reported

- **`AXChildren` refusal reported as empty list** — already closed by the `-3` sentinel and
  `ax-status.test.ts` (`106_accessibility.c:122-141`, `accessibility.ts:82-89`).
- **Typed refusals for `trusted`/`elementCount` adapter throws** — already closed by the `try/catch`
  in `accessibility-trust.ts:69-73,114-118` (hunt-21 finding 33, closed by #57).
- **Shadow-DOM omission and false `not-focusable`** — already closed in `a11y-page.ts:133-141,175-180`.
- **`announce` discards a successful post when the follow-up `trusted()` throws** — already filed in
  `docs/reviews/hunt-50/13-observability.md:66-71`; the code at `accessibility-page.ts:107-119` is
  unchanged.
- **`focus` N+1 synchronous AX reads and `announce`/`title` object leaks** — already filed in
  `docs/reviews/hunt-50/20-darwin-ax.md` findings 1 and 4.
- **macOS-only `requires` on non-darwin refusals, accelerator grammar narrowness, in-process
  `app.invoke` dropping menu events** — already filed in `docs/reviews/hunt-50/06-menu-tray-dock.md`.
- **`elementCount` self-process empty-list caveat and `testing.activation` gating** — the refusal
  names both and is documented (`accessibility-trust.ts:101-132`, guide `:109-124`); no new defect.
- **`pageTree` DOM-vs-OS note and `focusElement` active-element chain** — both annotations present and
  honest (`a11y-page.ts:25-27,175-189`); no new defect found here.

## Worst finding

Finding 1: `src/platform/darwin/shim/106_accessibility_page.c:185-194`. One page call to
`crust.accessibility.focus({ label })` returns `{ ok: true, focused: true }` on a matching window even
when every `AXUIElementSetAttributeValue` was refused. In an app that is untrusted by default, that is
the caller being told a screen reader moved when it did not.
