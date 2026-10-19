import { LuaFactory } from 'wasmoon';
import { mountData, collectData, fileArtifacts } from './file-runtime.mjs';
let factory, FS, settings;
self.onmessage = async ({ data: input }) => {
  let lua, started, output = '';
  const write = value => { if (output.length + value.length > 65536) throw new Error('输出超过 64 KB，已停止。'); output += value; };
  const readOutput = () => {
    const file = '/tmp/moyu-stdout';
    if (FS.stat(file).size > 65536) throw new Error('输出超过 64 KB。');
    return new TextDecoder().decode(FS.readFile(file));
  };
  try {
    if (input.type === 'init') {
      factory = new LuaFactory('moyu-run://sandbox/lua/glue.wasm', {}); FS = (await factory.getLuaModule()).module.FS;
      self.postMessage({ type: 'ready' }); return;
    }
    if (input.type === 'packages') { settings = input.runtimeSettings; self.postMessage({ type: 'packages' }); return; }
    if (input.type !== 'run') return;
    started = performance.now(); mountData(FS, input.files);
    lua = await factory.createEngine({ injectObjects: false, enableProxy: false });
    const stdin = settings.stdinFile && (input.files || []).some(file => file.name === settings.stdinFile) ? '/data/' + settings.stdinFile : '/dev/null';
    await lua.doString(`
      arg={${(settings.arguments||[]).map(value=>'"'+Array.from(new TextEncoder().encode(value),byte=>'\\'+String(byte).padStart(3,'0')).join('')+'"').join(',')}}
      os.execute=nil;os.exit=nil;os.getenv=nil;os.tmpname=nil;io.popen=nil
      package.cpath="";package.loadlib=nil;package.path="/data/?.lua;/data/?/init.lua"
      io.input(${JSON.stringify(stdin)})
      local stdout=assert(io.open("/tmp/moyu-stdout","w"))
      io.output(stdout);io.stdout=stdout;io.stderr=stdout
      local tostring,select,concat=tostring,select,table.concat
      print=function(...)
        local values={}
        for i=1,select("#",...) do values[i]=tostring(select(i,...)) end
        local text=concat(values,"\\t").."\\n"
        if stdout:seek("end")+#text>65536 then error("输出超过 64 KB，已停止。") end
        stdout:write(text)
      end
      ${settings.enableModules ? '' : 'require=nil;package=nil'}
    `);
    const value = await lua.doString(input.code);
    // Closing the state flushes and closes file handles before collecting files.
    lua.global.close(); lua = null;
    output = readOutput(); if (value !== undefined && value !== null) write(String(value) + '\n');
    const files = collectData(FS);
    self.postMessage({ type: 'result', output, artifacts: fileArtifacts(files), dataFiles: files, elapsed: performance.now() - started });
  } catch (error) {
    lua?.global.close(); lua = null;
    if (started) try { output = readOutput(); } catch {}
    let files; if (started) try { files = collectData(FS); } catch {}
    self.postMessage({ type: 'result', output, error: String(error.message || error), dataFiles: files, artifacts: files ? fileArtifacts(files) : [], elapsed: started ? performance.now() - started : 0 });
  } finally { lua?.global.close(); if (started) try { mountData(FS, []); } catch {} }
};
