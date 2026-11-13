#!/bin/zsh
# probe01: what toolchain is actually present, and what TinyCC headers ship with bun
echo "=== xcode-select ==="
xcode-select -p
echo "=== clang ==="
clang --version | head -2
echo "=== SDK ==="
xcrun --show-sdk-path
xcrun --show-sdk-version
echo "=== CommandLineTools present? ==="
ls -d /Library/Developer/CommandLineTools
echo "=== bun embedded tcc? ==="
fd -H 'tcc' /Users/jyz/.bun 2>/dev/null | head -5
echo "=== libobjc / frameworks ==="
ls -l /usr/lib/libobjc.A.dylib
ls -d /System/Library/Frameworks/AppKit.framework
echo "=== does a bare .c compile with cc -x c? ==="
printf 'int main(void){return 0;}\n' > /tmp/crust_probe_$$.c
cc -x c /tmp/crust_probe_$$.c -o /tmp/crust_probe_$$ && echo "cc -x c OK" || echo "cc -x c FAIL"
rm -f /tmp/crust_probe_$$.c /tmp/crust_probe_$$
exit 0