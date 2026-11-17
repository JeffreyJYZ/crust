# Lane I — devtools + tabbed material

## Fixed
- `src/config/types.ts:7` — `WindowMaterial` gains `"tabbed"`; comment names it Windows-only.
- `src/config/validate-windows.ts:18` — win32 accepts `tabbed`; darwin/linux keep it out of the allowed list, so validation refuses it by name (received `"tabbed"`, expected list names the platform).
- `src/platform/windows/shim/46_material.c:14` — DWM kind 4 accepted alongside 2 and 3.
- `src/platform/windows/window-open.ts:22` — `BACKDROP.tabbed = 4`; typed access + build gate + DWM refusal reuse the mica/acrylic path.
- `src/platform/darwin/shim/30_webview.c:84` — `shim_webview_enable_devtools` sets `developerExtrasEnabled` and guards `setInspectable:` with `respondsToSelector:` (macOS 13.3+).
- `src/platform/darwin/{shim-symbols.ts:45,index.ts:86,window-create.ts:79}` — FFI symbol + call at window creation.
- `src/platform/darwin/devtools.ts` — `DEV_INSPECT_ENV = "CRUST_DEV_INSPECT"` and strict `=== "1"` gate.
- `src/cli/dev.ts:22,136` — sets the flag before every dev path forks its runtime child, clears it in `finally`; a built app never sets it.

## Tests added
- `src/config/validate-tabbed.test.ts` — win32 accepts, darwin/linux refuse by name.
- `src/platform/windows/tabbed-material.test.ts` — kind 4, build gate, `material:100:4` sent.
- `src/platform/darwin/devtools.test.ts` — gate truth table, C selectors, dev.ts set/clear.

## Notes
- Gate is on `process.env`, inherited by the runtime child exactly like `RELOAD_ENV`; platform-specific logic stays in C, no GUI launch in tests.
- Linux has no runtime material path; config validation is the refusal gate there (matching mica/acrylic).
- Verified: 30 tests pass, `bun check` clean (675 files), `check:lines` PASS.
- Not mine: parity row / guide page live under `site/` and the docs lane; Linux runtime material is the material lane.
