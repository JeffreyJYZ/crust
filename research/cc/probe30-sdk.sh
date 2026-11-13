#!/bin/zsh
# probe30: which SDK does tcc use for headers? manipulate SDKROOT / DEVELOPER_DIR.
cd /Users/jyz/dev/crust/research/cc || exit 1
cat > "$TMPDIR/p30.c" <<'EOF'
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) { char *p = malloc(8); strcpy(p, "ok"); int n = (int)strlen(p); free(p); return n == 2 ? 0 : 1; }
EOF

run() { # $1 = label, rest = env assignments
  local label="$1"; shift
  out=$(env "$@" bun -e '
import { cc, FFIType } from "bun:ffi";
try { const r = cc({ source: process.env.TMPDIR + "/p30.c", symbols: { main: { args: [], returns: FFIType.int } } });
  console.log("COMPILED main()=" + r.symbols.main()); }
catch (e) { console.log("FAILED " + String(e.message).split("\n").filter(Boolean).slice(-1)[0]); }
process.exit(0);' 2>&1)
  echo "$label -> $out"
}

run "baseline (no SDKROOT)"
run "SDKROOT=CLT"        SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
run "SDKROOT=Xcode"      SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
run "SDKROOT=bogus"      SDKROOT=/nonexistent/sdk
run "DEVELOPER_DIR=CLT"  DEVELOPER_DIR=/Library/Developer/CommandLineTools
run "DEVELOPER_DIR=Xcode" DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
rm -f "$TMPDIR/p30.c"
exit 0