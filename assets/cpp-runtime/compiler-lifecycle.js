/** Hard-reset a compiler worker after timeout/init failure. */
export function discardCompilerWorker(runtime) {
  const worker = runtime._worker;
  runtime._worker = null;
  runtime._emception = null;
  runtime._initPromise = null;
  runtime._collecting = false;
  runtime._diagBuffer = "";
  runtime._fmtWritten = false;
  runtime._rangesWritten = false;
  runtime._viewsWritten = false;
  if (worker) {
    try { worker.terminate(); } catch { /* worker may already be dead */ }
  }
}
