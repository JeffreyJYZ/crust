/**
 * Lane A — the failing cases, written out for a human to read.
 *
 * This file is NOT under `src/`, so `bun check` does not read it and it can never pass by accident.
 * Every case below must be a *type error* against `src/bridge/typed.ts`. Each carries
 * `@ts-expect-error`, so running `bun check` over a copy that includes this path fails on an
 * unused directive the moment one of them stops being an error.
 *
 * The gate that actually runs is the same three negatives inline in
 * `src/bridge/typed.test.ts`, which `bun check` does read.
 */
import type { typedClient, typedHost } from "../src/bridge/typed.ts";

type NotesMap = {
	"notes.create": { input: { title: string }; output: { id: string } };
	"notes.count": { input: void; output: number };
};

declare const host: ReturnType<typeof typedHost<NotesMap>>;
declare const client: ReturnType<typeof typedClient<NotesMap>>;

// 1. A typo in a command name — the whole point of the map.
// @ts-expect-error "notes.creat" is not a key of NotesMap
host.command("notes.creat", () => ({ id: "n1" }));

// 2. The wrong input shape at the call site.
// @ts-expect-error `notes.create` takes `{ title: string }`, not `{ name: string }`
void client.invoke("notes.create", { name: "a" });

// 3. The input the handler is given is the mapped one, not `unknown`.
// @ts-expect-error `input` is `{ title: string }`, so `input.name` does not exist
host.command("notes.create", (input) => ({ id: input.name }));

// 4. The wrong answer shape at the handler.
// @ts-expect-error the map says `output` is `{ id: string }`
host.command("notes.create", () => 42);

// And the good path, which must compile.
export const ok = client.invoke("notes.create", { title: "a" });
export const count = client.invoke("notes.count", undefined as void);
