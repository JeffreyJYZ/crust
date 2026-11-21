/**
 * The pre-per-app vault sat at one machine-wide path for every crust app. Its entries are keyed by
 * service and account with no app identity, so it cannot be attributed to one app without keeping
 * the cross-app leak. This module never reads or copies it — it only makes the empty new vault
 * diagnosable: a first launch that creates a per-app vault while the legacy file still exists writes
 * one `warn` line naming both paths.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";

import { logEvent } from "@/logging/logger";

import { defaultStoreRoot, STORE_FILE } from "./stronghold-file.ts";

/** Say why every old secret is gone, once, when the fresh per-app vault is created. */
export async function noteLegacyVault(path: string): Promise<void> {
	const legacy = join(defaultStoreRoot("crust"), STORE_FILE);
	// With CRUST_DATA_DIR set, the legacy path *is* the per-app path, so there is nothing to explain.
	if (legacy === path) return;
	const exists = await stat(legacy).then(
		(info) => info.isFile(),
		() => false,
	);
	if (!exists) return;
	logEvent({
		level: "warn",
		source: "plugin",
		event: "stronghold.legacy-vault",
		msg: `stronghold created a per-app vault at ${path}; the legacy shared vault ${legacy} was not migrated, so re-set secrets stored before this version`,
		fields: { path, legacy },
	});
}
