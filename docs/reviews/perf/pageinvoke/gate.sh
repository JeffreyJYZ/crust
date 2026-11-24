#!/bin/sh
# Lane H gate runner. Writes each command's full output beside this file; never a piped tail.
cd "$(dirname "$0")/../../../.." || exit 1
for cmd in "bun check" "bun run test" "bun run test:no-skips" "bun run check:lines" "bun run e2e:single"; do
	name=$(printf '%s' "$cmd" | tr ' /' '__')
	printf 'GATE %s\n' "$cmd"
	eval "$cmd" > "docs/reviews/perf/pageinvoke/$name.log" 2>&1
	printf 'exit=%s\n' "$?"
done
