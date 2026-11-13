#!/bin/zsh
# probe32: where does cc() put its compiled artifact? isolate TMPDIR.
cd /Users/jyz/dev/crust/research/cc || exit 1
fresh=$(mktemp -d)
cat > "$fresh/a.c" <<'EOF'
int a(void) { return 7; }
EOF
echo "fresh TMPDIR=$fresh"
echo "--- contents before ---"
ls -A "$fresh"
env TMPDIR="$fresh" bun -e '
import { cc, FFIType } from "bun:ffi";
const r = cc({ source: process.env.TMPDIR + "/a.c", symbols: { a: { args: [], returns: FFIType.int } } });
console.log("a() =", r.symbols.a());
console.log("files after compile:", JSON.stringify(require("fs").readdirSync(process.env.TMPDIR)));
r.close();
console.log("files after close:", JSON.stringify(require("fs").readdirSync(process.env.TMPDIR)));
process.exit(0);' 2>&1
echo "--- contents after ---"
ls -Al "$fresh"
rm -rf "$fresh"
exit 0