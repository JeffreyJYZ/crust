import { shim } from "./index.ts";
import { cls, ptrValueZero, SEL } from "./objc.ts";

// --- selectors -------------------------------------------------------------

/**
 * Every selector this file sends, checked once before the application starts.
 *
 * `kind: "class"` means the receiver is a class object, and the honest test is
 * `[class respondsToSelector:]`. `kind: "instance"` means an instance method,
 * and the honest test is `class_getInstanceMethod`, which walks the superclass
 * chain. `class_getClassMethod` is never used: it reports `+init`/`+valueForKey:`
 * as present on every class through the metaclass chain.
 */
export interface PreflightEntry {
	owner: string;
	selector: string;
	kind: "class" | "instance";
}

const classSelectors: ReadonlyArray<readonly [string, string]> = [
	["NSApplication", "sharedApplication"],
	["NSWindow", "alloc"],
	["NSView", "alloc"],
	["WKWebView", "alloc"],
	[
		"NSLayoutConstraint",
		"constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:",
	],
	["NSLayoutConstraint", "constraintWithItem:attribute:relatedBy:constant:"],
];

const instanceSelectors: ReadonlyArray<readonly [string, string]> = [
	["NSWindow", "initWithContentRect:styleMask:backing:defer:"],
	["NSWindow", "setReleasedWhenClosed:"],
	["NSWindow", "contentView"],
	["NSWindow", "makeKeyAndOrderFront:"],
	["NSWindow", "orderFrontRegardless"],
	["NSWindow", "setCollectionBehavior:"],
	["NSWindow", "setTitle:"],
	["NSWindow", "title"],
	["NSWindow", "setContentMinSize:"],
	["NSWindow", "windowNumber"],
	["NSWindow", "isVisible"],
	["NSWindow", "isMiniaturized"],
	["NSWindow", "isReleasedWhenClosed"],
	["NSWindow", "isKeyWindow"],
	["NSWindow", "close"],
	["WKWebView", "init"],
	["WKWebView", "loadRequest:"],
	["NSApplication", "setActivationPolicy:"],
	["NSApplication", "finishLaunching"],
	["NSApplication", "isHidden"],
	["NSApplication", "activate"],
	["NSApplication", "isActive"],
	["NSApplication", "activateIgnoringOtherApps:"],
	["NSApplication", "terminate:"],
	["NSView", "addSubview:"],
	["NSView", "setWantsLayer:"],
	["NSView", "setTranslatesAutoresizingMaskIntoConstraints:"],
	["NSLayoutConstraint", "setActive:"],
];

/** The selectors `shim.c` itself sends; JS must verify them, C cannot. */
const internalClassSelectors: ReadonlyArray<readonly [string, string]> = [
	["NSString", "alloc"],
	["NSURL", "URLWithString:"],
	["NSURLRequest", "requestWithURL:"],
	// The open and save panels' C sections build every object they send to, so
	// these are verified here rather than at a call site JS can see.
	["NSOpenPanel", "openPanel"],
	["NSSavePanel", "savePanel"],
	["NSMutableArray", "array"],
];

const internalInstanceSelectors: ReadonlyArray<readonly [string, string]> = [
	// NSString is a class cluster: +alloc yields an NSPlaceholderString, and that
	// concrete class is where -initWithBytes:length:encoding: is implemented.
	["NSPlaceholderString", "initWithBytes:length:encoding:"],
	["NSWindow", "valueForKey:"],
	["NSValue", "getValue:"],
	["NSView", "valueForKey:"],
	// NSOpenPanel. `-beginSheetModalForWindow:completionHandler:` is the reason
	// the pick no longer blocks; `-cancel:` is what ends a sheet with no human.
	["NSOpenPanel", "setCanChooseFiles:"],
	["NSOpenPanel", "setCanChooseDirectories:"],
	["NSOpenPanel", "setAllowsMultipleSelection:"],
	["NSOpenPanel", "setTitle:"],
	["NSOpenPanel", "setAllowedFileTypes:"],
	["NSOpenPanel", "beginSheetModalForWindow:completionHandler:"],
	["NSOpenPanel", "runModal"],
	["NSOpenPanel", "cancel:"],
	["NSOpenPanel", "URLs"],
	// NSSavePanel: the same sheet and cancel machinery, a name field instead of
	// a selection shape, and -URL (singular) for the one chosen path.
	["NSSavePanel", "setTitle:"],
	["NSSavePanel", "setNameFieldStringValue:"],
	["NSSavePanel", "setAllowedFileTypes:"],
	["NSSavePanel", "beginSheetModalForWindow:completionHandler:"],
	["NSSavePanel", "runModal"],
	["NSSavePanel", "cancel:"],
	["NSSavePanel", "URL"],
	// The window a sheet attaches to, and the reads the fallback path makes.
	["NSApplication", "keyWindow"],
	["NSApplication", "mainWindow"],
	["NSApplication", "windows"],
	["NSMutableArray", "addObject:"],
	// -URLs is an NSArray; each element's -path is copied into C storage.
	["NSArray", "count"],
	["NSArray", "objectAtIndex:"],
	["NSURL", "path"],
	["NSString", "UTF8String"],
];

export const PREFLIGHT: readonly PreflightEntry[] = [
	...classSelectors.map(([owner, selector]) => ({ owner, selector, kind: "class" as const })),
	...instanceSelectors.map(([owner, selector]) => ({
		owner,
		selector,
		kind: "instance" as const,
	})),
	...internalClassSelectors.map(([owner, selector]) => ({
		owner,
		selector,
		kind: "class" as const,
	})),
	...internalInstanceSelectors.map(([owner, selector]) => ({
		owner,
		selector,
		kind: "instance" as const,
	})),
];

/**
 * Resolve one preflight entry against the runtime. Returns an error string
 * (never throws) so `start()` can name every missing selector at once.
 */
export function preflightError(entry: PreflightEntry): string | undefined {
	try {
		const target = cls(entry.owner);
		const sel = SEL(entry.selector);
		if (entry.kind === "class") {
			const responds = Number(shim().symbols.shim_responds(target, sel) ?? 0) === 1;
			return responds ? undefined : `+[${entry.owner} ${entry.selector}] not implemented`;
		}
		const method = shim().symbols.shim_instance_method(target, sel) ?? 0;
		return ptrValueZero(method) !== 0
			? undefined
			: `-[${entry.owner} ${entry.selector}] not implemented`;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
