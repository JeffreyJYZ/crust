/**
 * Lane A — typed IPC, runtime half.
 *
 * A type error cannot be asserted at runtime, so the three negatives live as `@ts-expect-error`
 * directives *inline here*: if a wrong name, a wrong input or a wrong output ever stopped being a
 * compile error, the directive becomes unused and `bun check` fails on this file. That is the proof,
 * and it is a gate rather than a comment. `docs/agents/typed-ipc-map-errors.ts` holds the same
 * cases in readable form for a human.
 *
 * The positives below run for real: one through `App` (the host side, `app.command`), one through a
 * recording client (the page side, `window.crust.invoke`).
 */
import { describe, expect, test } from "bun:test";
import { App } from "@/app.ts";
import { type TypedClientSource, typedClient, typedHost } from "./typed.ts";

/**
 * A declaration is a `type`, not an `interface`: only a type alias of an object literal gets the
 * implicit index signature that satisfies `extends InvokeMap`.
 */
type NotesMap = {
	"notes.create": { input: { title: string }; output: { id: string } };
	"notes.count": { input: void; output: number };
};

/** A one-entry map whose input is a string — the shape the old two-argument form misread. */
type GreetMap = { greet: { input: string; output: string } };

describe("typedHost", () => {
	test("registers through App.command, so its guards still apply", () => {
		const application = new App();
		const host = typedHost<NotesMap>(application);
		// A wrong name is a type error, not a runtime `unknown-command`.
		// @ts-expect-error "notes.creat" is not a key of NotesMap
		host.command("notes.creat", (input) => input.title);

		host.command("notes.count", () => 3);
		expect(application.invoke).toBeDefined();
	});

	test("the handler receives the mapped input and may answer the mapped output", async () => {
		const application = new App();
		const host = typedHost<NotesMap>(application);
		host.command("notes.create", async (input) => ({ id: input.title }));
		const answer = await application.invoke("notes.create", { title: "a" });
		expect(answer).toEqual({ id: "a" });
	});

	test("the wrong answer shape is a type error, on the registration site", () => {
		const host = typedHost<NotesMap>(new App());
		// @ts-expect-error the map says `output` is `{ id: string }`, not a number
		host.command("notes.create", () => 42);
		expect(true).toBe(true);
	});

	test("chaining returns the same typed host", () => {
		const host = typedHost<NotesMap>(new App());
		expect(host.command("notes.count", () => 0)).toBe(host);
	});
});

describe("typedClient", () => {
	function recording() {
		const seen: unknown[] = [];
		const bridge: TypedClientSource = {
			async invoke(...args: any[]) {
				seen.push(args);
				return 7;
			},
		};
		return { seen, client: typedClient<NotesMap>(bridge) };
	}

	test("routes an app command through app.invoke, so the input cannot be read as a plugin", async () => {
		const { seen, client } = recording();
		const count: number = await client.invoke("notes.count", undefined as void);
		// A name the map does not carry never compiles.
		// @ts-expect-error "notes.delete" is not a key of NotesMap
		void client.invoke("notes.delete", {});
		// The input shape is enforced too.
		// @ts-expect-error `notes.create` needs `{ title: string }`
		void client.invoke("notes.create", { name: "a" });
		expect(count).toBe(7);
		expect(seen[0]).toEqual(["app", "invoke", { name: "notes.count", args: undefined }]);
	});

	test("a string input stays the app command's argument, not a second invoke argument", async () => {
		const seen: unknown[] = [];
		const bridge: TypedClientSource = {
			async invoke(...args: any[]) {
				seen.push(args);
				return "hi";
			},
		};
		await typedClient<GreetMap>(bridge).invoke("greet", "Ada");
		expect(seen[0]).toEqual(["app", "invoke", { name: "greet", args: "Ada" }]);
	});

	test("invokePlugin splits a dotted map key into the client's plugin form", async () => {
		const { seen, client } = recording();
		const answer = await client.invokePlugin("notes.create", { title: "a" });
		expect(answer as unknown).toBe(7);
		expect(seen[0]).toEqual(["notes", "create", { title: "a" }]);
	});

	test("invokePlugin refuses a name with no dot instead of guessing a namespace", async () => {
		const greeter = typedClient<GreetMap>({ invoke: async () => "hi" });
		await expect(greeter.invokePlugin("greet", "Ada")).rejects.toThrow("plugin.command");
	});

	test("the output type flows back to the caller", async () => {
		const bridge: TypedClientSource = { invoke: async () => ({ id: "n1" }) };
		const created = await typedClient<NotesMap>(bridge).invoke("notes.create", { title: "a" });
		expect(created.id).toBe("n1");
	});
});
