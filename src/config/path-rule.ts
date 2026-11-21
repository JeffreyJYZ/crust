/**
 * A config path that is joined onto a fixed root must stay inside it. Checking only a leading
 * `/` misses `..` segments (which `join` folds into a climb) and Windows drive/UNC spellings
 * (which `path.isAbsolute` accepts on Windows but not on this host).
 */

import { isAbsolute } from "node:path";

export function isContainedRelative(value: string): boolean {
	if (value.trim() === "") return false;
	if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
		return false;
	}
	return !value.split(/[\\/]/).includes("..");
}
