# network-status lane (Lane Q) memory

## Measured 2026-11-17

- **`SCNetworkReachabilitySetDispatchQueue` cannot be linked through TinyCC here**: compiling a unit that calls `dispatch_get_main_queue()` dies `tcc: error: unresolved reference to '_dispatch_get_main_queue'`, because bun's runtime does not export libdispatch. `SCNetworkReachabilityScheduleWithRunLoop(CFRunLoopGetMain(), kCFRunLoopDefaultMode)` links, and lands on the same thread the pump already drives.
- **`SCNetworkInterfaceCopyAll` + `SCNetworkInterfaceGetInterfaceType` answers whole-machine kinds**: a real run printed `["wifi","wired","other"]`, so `interfaceKinds` must be joined from types, never inferred from a BSD name.
- **Reachability flags are decoded in JS, not C**: `reachable = 1<<1`, `connectionRequired = 1<<2`; a captive portal reads online, which is the honest answer to "is there a path".
- **A name-based target touches no DNS**: `SCNetworkReachabilityCreateWithName(0, "crust-status.invalid")` — the flags are about a path, not about whether the name answers.

## Structure

- **`network-types.ts` holds `NetworkStatusCommands`**, `network-status.ts` holds the two handlers, `network.ts` builds the plugin from `(interceptorAdapter, matchOptions, statusAdapter)`. The interceptor's four commands are untouched.
- **`runtime-network.ts` is where the runtime wires both adapters**, split out of `runtime-plugins.ts` because that file is at the 200-line cap.
