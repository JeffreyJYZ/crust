#!/bin/zsh
# probe18: cold-start latency, fresh process each run
cd /Users/jyz/dev/crust/research/cc || exit 1
for i in 1 2 3 4 5 6 7 8; do
  out=$(bun run probe17-latency.ts 2>&1)
  first=$(echo "$out" | rg -o 'run#0: [0-9.]+ms' | head -1)
  objc=$(echo "$out" | rg -o 'objc\+Foundation compile: [0-9.]+ms' | head -1)
  echo "process#$i  $first  $objc"
done
echo "=== leftover compiled dylibs in TMPDIR ==="
ls -1 "$TMPDIR"/.bun-* 2>/dev/null | wc -l
exit 0