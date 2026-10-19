// Clang/lld instances are temporary, but their MemFS and compiled modules are
// warm caches. llvm-core leaves MemFS.hostMem pointing at the last instance's
// linear memory. Detach it once that invocation finishes, including failures.
// Every subsequent App installs its own memory before accessing the filesystem.
export function releaseCompletedCompilerMemory(runtime) {
  const run = runtime.runWithOptions;
  runtime.runWithOptions = async function (...args) {
    let suspended;
    try {
      suspended = await run.apply(this, args);
      return suspended;
    } finally {
      // A suspended App still needs its memory. Compiler invocations normally
      // finish synchronously and return null; the program uses separate WASI.
      if (!suspended) {
        const bytes=this.memfs.hostMem_?.memory?.buffer?.byteLength||0;
        this.memfs.hostMem = null;
        // Let pending reclamation tasks run before starting the next large
        // instance. Small compiler calls and cached executions stay immediate.
        if(bytes>=32*1024*1024)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
  };
}
