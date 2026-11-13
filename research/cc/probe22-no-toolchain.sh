#!/bin/zsh
# probe22: does cc() need any external toolchain on PATH? run with a PATH holding only bun.
cd /Users/jyz/dev/crust/research/cc || exit 1
bunbin=$(command -v bun)
tmpd=$(mktemp -d)
mkdir -p "$tmpd/bin"
ln -s "$bunbin" "$tmpd/bin/bun"
echo "=== PATH restricted to $tmpd/bin ==="
env -i HOME="$HOME" PATH="$tmpd/bin" TMPDIR="$TMPDIR" "$tmpd/bin/bun" run probe17-latency.ts 2>&1 | head -12
echo "=== exit: $? ==="
rm -rf "$tmpd"
exit 0