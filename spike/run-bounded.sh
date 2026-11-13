#!/bin/zsh
# Bounded run of the spike: macOS has no `timeout`(1) by default, and a spike
# that hangs must never hang the shell. Usage: ./run-bounded.sh [seconds] [args…]
set -u
LIMIT=${1:-45}
shift 2>/dev/null || true
cd "$(dirname "$0")"
bun main.ts "$@" >/tmp/crust-spike.out 2>&1 </dev/null &
pid=$!
waited=0
while (( waited < LIMIT * 10 )); do
	if ! kill -0 $pid 2>/dev/null; then
		wait $pid 2>/dev/null
		rc=$?
		cat /tmp/crust-spike.out
		print -r -- "--- exited rc=$rc"
		exit $rc
	fi
	sleep 0.1
	(( waited++ ))
done
print -r -- "--- STILL RUNNING after ${LIMIT}s, killing pid $pid"
cat /tmp/crust-spike.out
kill -9 $pid 2>/dev/null
print -r -- "--- killed"
exit 124
