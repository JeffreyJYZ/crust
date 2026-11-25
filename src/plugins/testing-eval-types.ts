/** Evidence carried by an answer whose request is gone, and by a real eval timeout. */

export interface DroppedCompletion {
	id: number;
	kind: number;
	text: string;
	/** Ids with a live waiter when the completion arrived. */
	waitedIds: number[];
	/** Wall time since this queue began, so a late answer is not confused with a lost one. */
	elapsedMs: number;
}

export interface TimeoutDetail {
	id: number;
	/** Ids with a live waiter at expiry, including the id that just expired. */
	waitedIds: number[];
	progressStart: number;
	progressNow: number;
	wallStart: number;
	wallNow: number;
	elapsedMs: number;
	/** rAF frames: a visibility signal, since WebKit stops painting a page it considers hidden. */
	framesStart: number;
	framesNow: number;
	visibilityStart: string;
	visibilityNow: string;
	/** A `setInterval` tick: unlike frames it keeps advancing in a hidden page, though throttled. */
	heartbeatStart: number;
	heartbeatNow: number;
	/** Completions delivered off the sink's thread, counted by the native unit. */
	offMain: number;
}
