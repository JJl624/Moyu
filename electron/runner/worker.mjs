import {nameOf, decode, encode} from './run-files.mjs';
let python,language,output='',artifacts=[],warming=false,namespace,runStart=0;
let data=new Map();
const writeFile=async(name,value)=>{name=nameOf(name);const bytes=typeof value==='string'?new TextEncoder().encode(value):value instanceof Uint8Array?value:new Uint8Array(value);data.set(name,bytes);};
self.files=Object.freeze({root:'/data',readFile:async(name,encoding='utf8')=>{const bytes=data.get(nameOf(name));if(!bytes)throw new Error('数据文件不存在：'+name);return encoding==='utf8'?new TextDecoder().decode(bytes):bytes.slice();},writeFile,list:async()=>[...data.keys()],remove:async name=>data.delete(nameOf(name)),download:async(url,name)=>{name=nameOf(name);const response=await fetch('/download?url='+encodeURIComponent(url));if(!response.ok)throw new Error(await response.text());await writeFile(name,new Uint8Array(await response.arrayBuffer()));return name;}});
self.moyu_download=async(url,name)=>{name=nameOf(name);const response=await fetch('/download?url='+encodeURIComponent(url));if(!response.ok)throw new Error(await response.text());const bytes=new Uint8Array(await response.arrayBuffer());python.FS.mkdirTree('/data/'+name.split('/').slice(0,-1).join('/'));python.FS.writeFile('/data/'+name,bytes);return name;};
function dataFiles(){const out=[];const add=(name,bytes)=>{if(out.length>=128)throw new Error('代码数据超过 128 个文件。');out.push({name:nameOf(name),data:encode(bytes)});};
  if(python){const visit=(dir,prefix='')=>{for(const name of python.FS.readdir(dir)){if(name==='.'||name==='..')continue;const full=dir+'/'+name,stat=python.FS.lstat(full);if(python.FS.isDir(stat.mode))visit(full,prefix+name+'/');else if(python.FS.isFile(stat.mode))add(prefix+name,python.FS.readFile(full));}};visit('/data');visit('/output','output/');}else for(const [name,bytes] of data)add(name,bytes);return out;
}
const write=text=>{if(!warming&&output.length<65536)output+=String(text).slice(0,65536-output.length)+'\n';};
const format=value=>{try{return typeof value==='string'?value:JSON.stringify(value)??String(value);}catch{return String(value);}};
self.displayHTML=(html,name='result.html')=>{const bytes=new TextEncoder().encode(String(html));if(artifacts.length>=20)throw Error('HTML 结果超过限制。');artifacts.push({kind:'html',name,mime:'text/html',data:encode(bytes)});};
for(const key of ['log','info','warn','error','debug','dir'])console[key]=(...args)=>write(args.map(format).join(' '));
console.table=value=>{
  if(!Array.isArray(value)){write(format(value));return;}
  const columns=[],seen=new Set();let truncated=value.length>1000,budget=4*1024*1024;
  for(const row of value.slice(0,1000))for(const key of row&&typeof row==='object'?Object.keys(row):['值'])if(!seen.has(key)){seen.add(key);if(columns.length<100)columns.push(key);else truncated=true;}
  const rows=[];
  for(const row of value.slice(0,1000)){
    const cells=columns.map(key=>{const raw=String(row&&typeof row==='object'?row[key]??'':row);if(raw.length>2000)truncated=true;return raw.slice(0,2000);});
    const size=cells.reduce((n,c)=>n+c.length,0);if(size>budget){truncated=true;break;}budget-=size;rows.push(cells);
  }
  artifacts.push({kind:'table',name:'table-'+(artifacts.length+1)+'.csv',columns:columns.map(c=>c.slice(0,200)),rows,truncated});
};
const helpers=String.raw`
import os, sys, json, base64, io, pathlib
import js
sys.dont_write_bytecode = True
async def download(url, name):
    return await js.moyu_download(url, name)
os.environ['MPLBACKEND'] = 'agg'
os.makedirs('/output', exist_ok=True)
_moyu_results = []
_moyu_figures = set()
_moyu_sys_path = list(sys.path)

def _moyu_name(kind, extension):
    return f'{kind}-{len(_moyu_results)+1}.{extension}'
def _moyu_table(columns, rows, name, truncated=False):
    columns = list(columns)
    truncated = truncated or len(columns) > 100
    labels = [str(c)[:200] for c in columns[:100]]
    saved, budget = [], 4 * 1024 * 1024
    for index, row in enumerate(rows):
        if index >= 1000:
            truncated = True
            break
        cells = []
        for cell in row[:100]:
            raw = str(cell)
            truncated = truncated or len(raw) > 2000
            cells.append(raw[:2000])
        size = sum(len(c) for c in cells)
        if size > budget:
            truncated = True
            break
        budget -= size
        saved.append(cells)
    _moyu_results.append(dict(kind='table', name=name or _moyu_name('table','csv'), columns=labels, rows=saved, truncated=truncated))

def display(value, name=None):
    if len(_moyu_results) >= 20: return
    if hasattr(value, 'columns') and hasattr(value, 'itertuples'):
        _moyu_table(value.columns, value.iloc[:1000, :100].itertuples(index=False, name=None), name, len(value)>1000 or len(value.columns)>100)
    elif hasattr(value, 'savefig'):
        target = io.StringIO(); value.savefig(target, format='svg'); content = target.getvalue()
        _moyu_results.append(dict(kind='image', name=name or f'figure-{getattr(value,"number",len(_moyu_results)+1)}.svg', mime='image/svg+xml', data=base64.b64encode(content.encode()).decode())); _moyu_figures.add(id(value))
    elif hasattr(value, 'save') and hasattr(value, 'size'):
        target = io.BytesIO(); value.save(target, format='PNG'); data = target.getvalue()
        _moyu_results.append(dict(kind='image', name=name or (pathlib.Path(value.filename).stem+'.png' if getattr(value,'filename','') else _moyu_name('image','png')), mime='image/png', data=base64.b64encode(data).decode()))
    elif isinstance(value, (list, tuple)) and value and isinstance(value[0], dict):
        columns=list(dict.fromkeys(k for r in value[:1000] for k in r))[:101]
        _moyu_table(columns, ([r.get(c,'') for c in columns[:100]] for r in value[:1000]), name, len(value)>1000)
    elif isinstance(value, (bytes, bytearray)):
        _moyu_results.append(dict(kind='file', name=name or _moyu_name('result','bin'), mime='application/octet-stream', data=base64.b64encode(value).decode()))
    else: print(value)
def _moyu_finish():
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is not None:
        for number in plt.get_fignums():
            fig=plt.figure(number)
            if id(fig) not in _moyu_figures: display(fig)
        plt.close('all')
    for file in sorted(pathlib.Path('/output').rglob('*')):
        if len(_moyu_results)>=20: break
        if file.is_file() and not file.is_symlink():
            data=file.read_bytes();mime='image/svg+xml' if file.suffix=='.svg' else 'image/png' if file.suffix=='.png' else 'application/octet-stream'
            _moyu_results.append(dict(kind='image' if mime.startswith('image/') else 'file',name=file.name,mime=mime,data=base64.b64encode(data).decode()))
    return json.dumps(_moyu_results)

import builtins
_moyu_import_original = builtins.__import__
def _moyu_import(name, globals=None, locals=None, fromlist=(), level=0):
    module = _moyu_import_original(name, globals, locals, fromlist, level)
    if name.startswith('matplotlib'):
        plt = sys.modules.get('matplotlib.pyplot')
        if plt is not None and hasattr(plt, 'show') and not getattr(plt.show, '_moyu', False):
            def show(*args, **kwargs):
                for number in plt.get_fignums(): display(plt.figure(number))
            show._moyu = True
            plt.show = show
    return module
builtins.__import__ = _moyu_import

def _moyu_reset():
    _moyu_results.clear(); _moyu_figures.clear()
    builtins.__import__ = _moyu_import
    sys.path[:] = ['/data', *_moyu_sys_path]
    for name, module in list(sys.modules.items()):
        if str(getattr(module, '__file__', '')).startswith(('/data/', '/output/')): sys.modules.pop(name, None)
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is not None:
        plt.close('all'); plt.rcdefaults()
        def show(*args, **kwargs):
            for number in plt.get_fignums(): display(plt.figure(number))
        show._moyu = True; plt.show = show
    return dict(__name__='__main__', display=display, download=download)

def _moyu_release():
    _moyu_results.clear(); _moyu_figures.clear()
    for name, module in list(sys.modules.items()):
        if str(getattr(module, '__file__', '')).startswith(('/data/', '/output/')): sys.modules.pop(name, None)
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is not None: plt.close('all')

def _moyu_preload(source):
    import ast, importlib
    try: tree=ast.parse(source)
    except SyntaxError: return
    for node in ast.walk(tree):
        names=[alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) and not node.level else []
        for name in names:
            if name and name.split('.')[0] in {'numpy','pandas','scipy','sklearn','matplotlib','PIL'}:
                try: importlib.import_module(name)
                except Exception: pass
`;
async function preload(source){warming=true;try{python.globals.set('_moyu_preload_source',source);await python.runPythonAsync('_moyu_preload(_moyu_preload_source)');}finally{python.globals.delete('_moyu_preload_source');warming=false;}}
function clearDirectory(directory){try{for(const name of python.FS.readdir(directory)){if(name==='.'||name==='..')continue;const target=directory+'/'+name,stat=python.FS.lstat(target);if(python.FS.isDir(stat.mode)){clearDirectory(target);python.FS.rmdir(target);}else python.FS.unlink(target);}}catch(error){if(error.errno!==44)throw error;}}
function setPythonArguments(args=[]){python.globals.set('_moyu_arguments',JSON.stringify(args));try{python.runPython("sys.argv = ['-c', *json.loads(_moyu_arguments)]");}finally{python.globals.delete('_moyu_arguments');}}
const send=postMessage.bind(self);
self.onmessage=async event=>{
  let result;
  try {
    if(event.data.type==='init'){
      language=event.data.language;
      if(language==='python'||language==='py'){
        const {loadPyodide}=await import('/pyodide/pyodide.mjs');python=await loadPyodide({indexURL:'moyu-run://sandbox/pyodide/',stdout:write,stderr:write});
        await python.runPythonAsync(helpers);
        // Preload imports without executing the user's source. Unfinished code
        // is allowed while editing; its syntax errors are reported on run.
        if(event.data.code)try{await python.loadPackagesFromImports(event.data.code,{checkIntegrity:true,messageCallback:()=>{},errorCallback:()=>{}});await preload(event.data.code);}catch{}
      }
      send({type:'ready'});return;
    }
    if(event.data.type==='packages'){
      try{
        if(python){
          setPythonArguments(event.data.arguments||[]);
          const sources=[event.data.code,...(event.data.files||[]).filter(f=>f.name.endsWith('.py')&&f.data.length<=270000).map(f=>new TextDecoder().decode(decode(f.data)))];
          await python.loadPackagesFromImports(sources.join('\n'),{checkIntegrity:true,messageCallback:()=>{},errorCallback:()=>{}});
          await preload(event.data.code);
        }
        send({type:'packages'});
      }catch(error){send({type:'packages',error:String(error?.stack||error)});}
      return;
    }
    if(event.data.type!=='run')return;
    const start=performance.now();runStart=start;output='';artifacts=[];
    data=new Map((event.data.files||[]).map(f=>[nameOf(f.name),decode(f.data)]));
    if(python){python.FS.chdir('/');clearDirectory('/data');clearDirectory('/output');clearDirectory('/tmp');python.FS.mkdirTree('/data');python.FS.mkdirTree('/output');for(const [name,bytes] of data){python.FS.mkdirTree('/data/'+name.split('/').slice(0,-1).join('/'));python.FS.writeFile('/data/'+name,bytes);}python.FS.chdir('/data');namespace?.destroy();namespace=python.runPython('_moyu_reset()');setPythonArguments(event.data.arguments||[]);}
    result=python?await python.runPythonAsync(event.data.code,{globals:namespace}):await new(Object.getPrototypeOf(async function(){}).constructor)(event.data.code)();
    if(result!==undefined&&result!==null){if(python){python.globals.set('_moyu_value',result);await python.runPythonAsync("display(_moyu_value) if hasattr(_moyu_value, 'columns') or hasattr(_moyu_value, 'savefig') or hasattr(_moyu_value, 'save') or isinstance(_moyu_value, (bytes, bytearray)) else print(_moyu_value)");}else write(format(result));}
    if(python){artifacts=JSON.parse(await python.runPythonAsync('_moyu_finish()'));}
    send({type:'result',output,artifacts,dataFiles:dataFiles(),elapsed:performance.now()-start});
  }catch(error){if(python)try{artifacts=JSON.parse(await python.runPythonAsync('_moyu_finish()'));}catch{}let stored;try{stored=dataFiles();}catch{}send({type:'result',output,artifacts,dataFiles:stored,elapsed:runStart?performance.now()-runStart:0,error:String(error?.stack||error)});}
  finally{if(event.data.type==='run'){
    if(python?.globals.has('_moyu_value'))python.globals.delete('_moyu_value');result?.destroy?.();namespace?.destroy();namespace=undefined;
    // postMessage has already cloned the result and file data. Release the
    // sandbox's duplicate buffers while keeping the interpreter/packages warm.
    output='';artifacts=[];data.clear();runStart=0;
    if(python)try{python.runPython('_moyu_release()');setPythonArguments();python.FS.chdir('/');clearDirectory('/data');clearDirectory('/output');clearDirectory('/tmp');}catch{/* Cleanup must not replace a completed result. */}
  }}
};
