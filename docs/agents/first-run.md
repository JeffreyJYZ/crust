# first-run lane — traps worth keeping

Lane 6 of the next-wave review. Report at `docs/reviews/next-wave/first-run.md`. Lane memory, not a
contract: re-read the code before trusting a line here.

- **`crust dev` probes launch real GUI windows and steal focus.** After every dev probe, run `open -a Ghostty` last so the human is not left looking at a test window. A `timeout N bunx crust dev` left no orphan `vite`/`next dev` processes here (`ps -Ao pid,ppid,etime,args | rg -i 'crust dev|vite|next dev|next-server'` was empty), but confirm rather than assume.
- **zsh does not word-split a string holding a command.** `C="bun run src/cli/index.ts"; $C "$@"` fails `...: no such file or directory`; pass the argv as literal tokens or a zsh array instead.
- **`bunx crust dev` from a scaffold resolves the checkout via `link:`**, so first-run probes hit the live source; a published install would read `github:JeffreyJYZ/crust`. The dev crash seen for Svelte/Vue is therefore a current-source defect, not a stale install.
- **Do not root-cause findings here.** This lane reports the newcomer experience; the Svelte/Vue `document is not defined` crash and the Next self-restart belong to the defects lane.
- **Keep scaffolds in temp and delete them.** The 200-line cap applies to this file and the report; both stay well under it.
