const {randomUUID}=require('node:crypto');
const {CodeRunner}=require('./runner.cjs');
const {TerminalLine}=require('./terminal-line.cjs');
class WasmTerminal {
  constructor({settings,runtimes,publish}){this.settings=settings;this.runtimes=runtimes;this.publish=publish;this.sessions=new Map();this.pending=0;this.generation=0;this.preparing=new Set();}
  shells(){return [{id:'bash-wasm',label:'Bash (Wasm)',shell:'moyu:bash-wasm',arguments:[]}];}
  list(){return [...this.sessions.values()].map(s=>({id:s.id,pid:0,title:'Bash (Wasm)',cwd:'/data',exited:false}));}
  get(id){const s=this.sessions.get(id);if(!s)throw Error('终端已关闭。');return s;}
  async open(){
    if(this.sessions.size+this.pending>=6)throw Error('最多同时打开 6 个终端。');this.pending++;
    const ticket=this.generation,runner=new CodeRunner(null,this.settings,this.runtimes);runner.namespace='moyu-terminal-'+randomUUID();let env;
    try{
      const runtime=await this.runtimes.environment('bash'),limits=await this.settings.config('bash');if(ticket!==this.generation)throw Error('已取消打开终端。');env=runner.environment('bash',runtime,'',limits);this.preparing.add(env);await env.ready;
      await Promise.race([env.win.webContents.executeJavaScript(`window.prepareTerminal(${JSON.stringify(limits)})`),env.aborted]);
      if(ticket!==this.generation)throw Error('已取消打开终端。');
      const id='wasm-'+randomUUID(),s={id,runner,env,history:'',offset:0,line:null};
      s.line=new TerminalLine({write:text=>this.output(s,text),execute:code=>this.execute(s,code,limits),exit:code=>this.finish(id,code),interrupt:()=>this.finish(id,130)});
      this.sessions.set(id,s);s.line.start();return this.list().find(value=>value.id===id);
    }catch(error){if(env)await env.dispose();throw error;}finally{this.preparing.delete(env);this.pending--;}
  }
  output(s,text){if(!this.sessions.has(s.id)||!text)return;text=text.replace(/(?<!\r)\n/g,'\r\n');s.history=(s.history+text).slice(-512*1024);s.offset+=text.length;this.publish({type:'data',id:s.id,data:text,offset:s.offset});}
  async execute(s,code,limits){
    let timeout,polling=false;
    const drain=async()=>{if(!s.env.win.isDestroyed())this.output(s,await s.env.win.webContents.executeJavaScript('window.takeTerminalOutput()'));};
    const interval=setInterval(()=>{if(!polling){polling=true;void drain().catch(()=>{}).finally(()=>{polling=false;});}},40);
    try {
      const result=await Promise.race([s.env.win.webContents.executeJavaScript(`window.runTerminal(${JSON.stringify(code)})`),s.env.aborted,new Promise((_,reject)=>{timeout=setTimeout(()=>{this.finish(s.id,124);reject(Error('Bash 命令超时，终端已关闭。'));},limits.executionTimeoutSeconds*1000+1000);})]);
      await drain();if(result.error)this.output(s,result.error+'\n');return result;
    }finally{clearInterval(interval);clearTimeout(timeout);}
  }
  write({id,data}){if(typeof data!=='string'||data.length>65536)throw Error('终端输入过大。');this.get(id).line.push(data);}
  resize({id,cols,rows}){this.get(id);if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1||cols>500||rows>500)throw Error('终端尺寸无效。');}
  acknowledge({id}){this.get(id);}
  snapshot(id){const s=this.get(id);return {...this.list().find(value=>value.id===id),output:s.history,offset:s.offset};}
  finish(id,exitCode){this.close(id);this.publish({type:'exit',id,exitCode});}
  close(id){const s=this.sessions.get(id);if(!s)return;this.sessions.delete(id);s.line.closed=true;void s.env.dispose();s.runner.close();}
  closeAll(){this.generation++;for(const env of this.preparing)void env.dispose();this.preparing.clear();for(const id of [...this.sessions.keys()])this.close(id);}
}
module.exports={WasmTerminal};
