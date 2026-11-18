# fix-comment-drift — traps worth keeping

- A tuned constant quoted in a comment can drift from the literal the code passes: `shim/50_app.c:72` and `app-types.ts:94` said "0.25 ms slice" while the shim passes `0.004` (4 ms deadline) and `0.002` (2 ms fallback). The `research/runloop` sweep really measured 0.25 ms at 186/187 ticks (99.5%) and 4 ms at 82.4%; keep that as sweep evidence, never as the shim's setting. F5's corrected `site/app/docs/design/page.mdx` is the phrasing to mirror.
- BRIEF-3's shorthand "measured optimum is 4 ms / 2 ms" is inverted — the sources (perf.md, F5's design page and notes) agree the optimum is 0.25 ms and the shim ships 4 ms / 2 ms. Follow the sources, not the shorthand.
- This is a comment-drift lane: correct the comments, not the `0.004`/`0.002` literals. Changing the pump deadline would be a runtime behaviour change needing e2e proof, out of scope here.
- Two perf numbers can both be true: evidence page's 790.1 ms window is the worst of ten mixed launches on 0.1.12–0.1.20; perf.md's 1,322.5 ms is a single true cold first launch on 0.1.26. Name machine and conditions for each rather than replacing one.
- `site/app/docs/evidence/page.mdx` carried F5's re-measured binary-size (line 57–59) and idle-memory (line 11) rows; edit only the cold-start row and add the note, preserving those rows byte-for-byte.
- README's binary size tracks the same measurement as `limits/page.mdx`'s "~86 MiB floor"; keep them aligned.
