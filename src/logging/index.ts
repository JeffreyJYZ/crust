/**
 * The structured log's public surface: the record shape and levels, the redaction pass, the sink and
 * its rotation, the process logger the wiring calls, and the SDK logger an app's own code uses.
 * `crust:logging`'s plugin is `src/plugins/logging.ts`; everything here works without a platform.
 */

export * from "./types.ts";
export {
	configuredLogLevel,
	envLogLevel,
	LEVEL_NAMES,
	type LevelSources,
	resolveLogLevel,
} from "./level.ts";
export { capText, oneLineMessage } from "./message.ts";
export { redactFields, redactText, redactValue, isSecretName, REDACTED } from "./redact.ts";
export { buildRecord, isoAt, parseLine, serializeRecord, sinceMs } from "./record.ts";
export { archivePath, rotateChain } from "./rotate.ts";
export { createSink, type Sink, type SinkOptions, type SinkOutcome } from "./sink.ts";
export { logDirs, type LogDirOptions, type LogDirs } from "./paths.ts";
export {
	configureLogger,
	flushLogger,
	logEvent,
	loggerLevel,
	loggerPaths,
	type LoggerOptions,
	repointLogFile,
	resetLogger,
	setLoggerLevel,
	tailRecords,
	writeRecord,
	type WriteResult,
} from "./logger.ts";
export { APP_LOG_EVENT, type AppLogger, createLog, log } from "./app.ts";
export {
	appRecord,
	invokeRecord,
	type InvokeFields,
	pageRecord,
	type PageLogPayload,
	platformRecord,
	type RefusalReason,
	refuseRecord,
	type WindowEvent,
	windowRecord,
} from "./records.ts";
