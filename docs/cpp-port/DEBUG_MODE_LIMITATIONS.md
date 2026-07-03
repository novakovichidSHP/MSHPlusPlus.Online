# Browser-only C++ Debug Mode: current limits

Debug mode is implemented as a static browser-only instrumentation layer. It does not use gdb/lldb or a backend sandbox. Before compilation, the IDE builds a temporary instrumented copy of project sources and headers, adds debug hooks, and runs the resulting WASM module through the existing Asyncify worker path.

## Supported practical subset

- Multi-file projects using `.cpp`, `.cc`, `.cxx`, `.c`, `.h`, `.hpp`, `.hxx`, `.hh`.
- Breakpoints by original file and line.
- Continue, Step over, Step into, Step out on user-code hook points.
- Locals/watch display for simple visible variables after declaration: `int`, `long long`, `long`, `short`, `double`, `float`, `bool`, `char`, `std::string`.
- String/char values are JSON-escaped before they are sent to the UI.

## Known limitations

- The source mapper is tokenizer-based, not AST-based. Complex macros, generated code, unusual formatting, lambdas, templates with multiline headers, and declarations hidden behind typedefs may not receive precise hooks.
- Breakpoints are resolved only at instrumented executable lines. A breakpoint on a declaration, brace, preprocessor line, or unsupported statement can be shown in the gutter but will not pause until execution reaches another hook.
- Breakpoint changes apply to the next debug run. During an active debug session, the UI keeps breakpoint editing disabled to avoid showing state that the worker cannot update dynamically yet.
- Step over/into/out works at hook granularity. It hides service files and STL because hooks are injected only into user project files, but it is not instruction-level native debugging.
- Watch is name-based for already captured simple locals. Arbitrary expressions and side-effect-free generated probes are not implemented yet.
- Generated debug files (`__debug_runtime.cpp`, `__debug_runtime_lib.js`, helper preambles) are temporary compile artifacts. They must not be saved in projects or included in share/export payloads.

## Verification expectations

- `npm test` must cover instrumentation maps, debug state transitions, and serializer behavior.
- Browser smoke should cover Debug pause/resume/step, multi-file breakpoints, Variables/Watch, Stop cleanup, ordinary Run baseline, and share/export payloads without generated debug files.
