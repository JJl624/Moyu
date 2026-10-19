// The system image lives for the toolchain's lifetime. Source, object and
// executable files are disposable overlays, never added to its native heap.
export function compilerWorkspace(runtime) {
  const fs=runtime.memfs,systemFiles=new Set(fs.filePaths),addFile=fs.addFile;
  const initialBytes=fs.mem.memory.buffer.byteLength;
  fs.addFile=function(path,contents){
    const name=this.normalizePath(path);
    if(systemFiles.has(name))return addFile.call(this,path,contents);
    // llvm-core already converts source strings to UTF-8 byte strings. Match
    // native MemFS's byte writes; encoding again corrupts non-ASCII literals.
    this.setFile(name,typeof contents==='string'?Uint8Array.from(contents,char=>char.charCodeAt(0)&255):contents);
  };
  return {
    clear(){
      for(const name of fs.fileOverlays.keys())if(!systemFiles.has(name)){
        fs.fileOverlays.delete(name);fs.filePaths.delete(name);
      }
      runtime.lastBuildKey='';runtime.wasm=undefined;
    },
    // Directory metadata still uses native MemFS. Bound unusual workloads
    // with many distinct directories, rather than recycling every eight edits.
    needsRecycle(){return fs.mem.memory.buffer.byteLength>initialBytes+32*1024*1024;},
  };
}
