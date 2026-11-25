/** Small shared pieces of the stronghold plugin, split so the command surface stays under the line cap. */

import {
	failure,
	type DerivedKeys,
	type KeyArgs,
	type StrongholdFailure,
	type StrongholdFile,
} from "./stronghold-types.ts";

export interface Session {
	file: StrongholdFile;
	keys: DerivedKeys;
}

export function locked(command: string): StrongholdFailure {
	return failure("locked", `stronghold.${command} needs open first`);
}

export function badRequest(message: string): StrongholdFailure {
	return failure("bad-request", message);
}

export function readKey(args: unknown): string | undefined {
	const key = (args as KeyArgs | undefined)?.key;
	return typeof key === "string" && key.length > 0 ? key : undefined;
}
