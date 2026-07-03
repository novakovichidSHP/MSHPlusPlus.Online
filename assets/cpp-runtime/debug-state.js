export function createDebugKey(file, line) {
  return `${file}:${line}`;
}

export function createDebugSession(debug) {
  if (!debug || !debug.map) return null;
  const filesById = new Map((debug.map.files || []).map((file) => [Number(file.id), file.name]));
  const functionsById = new Map((debug.map.functions || []).map((fn) => [Number(fn.id), fn.name]));
  return {
    filesById,
    functionsById,
    breakpoints: new Set(debug.breakpoints || []),
    paused: false,
    last: null,
    resumeMode: "entry",
    skipKey: null,
    stepTargetFunctionId: null
  };
}

export function applyDebugCommand(session, command) {
  if (!session) return null;
  session.paused = false;
  session.skipKey = session.last ? createDebugKey(session.last.file, session.last.line) : null;
  session.stepTargetFunctionId = session.last ? session.last.functionId : null;
  if (command === "stepOver") session.resumeMode = "stepOver";
  else if (command === "stepInto") session.resumeMode = "stepInto";
  else if (command === "stepOut") session.resumeMode = "stepOut";
  else {
    session.resumeMode = "continue";
    session.stepTargetFunctionId = null;
  }
  return session.resumeMode;
}

export function decodeDebugVars(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed).map(([name, value]) => ({
      name,
      value: String(value)
    }));
  } catch (error) {
    return [];
  }
}

export function evaluateDebugPoint(session, fileId, line, functionId, varsJson = "") {
  if (!session) return { pause: false, frame: null, enteredPause: false };
  const file = session.filesById.get(Number(fileId)) || "<unknown>";
  const fn = session.functionsById.get(Number(functionId)) || "<global>";
  const frame = {
    file,
    line: Number(line),
    functionId: Number(functionId),
    functionName: fn,
    variables: decodeDebugVars(varsJson)
  };

  if (session.paused) return { pause: true, frame: session.last || frame, enteredPause: false };

  const last = session.last;
  const samePoint = last && last.file === frame.file && last.line === frame.line;
  const key = createDebugKey(frame.file, frame.line);
  const skipThisPoint = session.skipKey === key;
  if (skipThisPoint) session.skipKey = null;
  const hasBreakpoint = !skipThisPoint && session.breakpoints.has(key);
  let shouldPause = hasBreakpoint;
  if (session.resumeMode === "entry") shouldPause = true;
  else if (session.resumeMode === "stepInto" && !samePoint) shouldPause = true;
  else if (session.resumeMode === "stepOver" && !samePoint && frame.functionId === session.stepTargetFunctionId) shouldPause = true;
  else if (session.resumeMode === "stepOut" && last && frame.functionId !== session.stepTargetFunctionId) shouldPause = true;

  session.last = frame;
  if (!shouldPause) return { pause: false, frame, enteredPause: false };
  session.paused = true;
  session.resumeMode = "continue";
  session.stepTargetFunctionId = null;
  return { pause: true, frame, enteredPause: true };
}
