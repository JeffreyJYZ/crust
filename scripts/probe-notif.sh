#!/bin/zsh
# Why does a bundled crust app get notification authorisation refused?
#
# The app is launched directly, so it never goes through LaunchServices and may be
# unknown to the notification daemon. This registers the bundle first, re-runs the
# same page-driven check, and prints what the OS answers — registration-related or
# not, the answer is measured rather than inferred.
set -u
APP="/tmp/crust-notif/dist/crust notif.app"
BIN="$APP/Contents/MacOS/crust-app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [[ ! -x "$BIN" ]]; then
	print -r -- "missing $BIN — build /tmp/crust-notif first"
	exit 1
fi

print -r -- "--- before registration ---"
"$BIN" > /tmp/notif-before.out 2>&1 &
pid=$!
sleep 6
kill -TERM $pid 2>/dev/null
wait $pid 2>/dev/null
rg -o 'notify .*' /tmp/notif-before.out || print -r -- "no notify line"

print -r -- "--- registering ---"
"$LSREG" -f "$APP" && print -r -- "lsregister ok"
"$LSREG" -dump 2>/dev/null | rg -m1 -A2 'land\.jyz\.notif' || print -r -- "not found in lsregister dump"

print -r -- "--- after registration ---"
"$BIN" > /tmp/notif-after.out 2>&1 &
pid=$!
sleep 6
kill -TERM $pid 2>/dev/null
wait $pid 2>/dev/null
rg -o 'notify .*' /tmp/notif-after.out || print -r -- "no notify line"
pkill -f 'crust notif' 2>/dev/null
