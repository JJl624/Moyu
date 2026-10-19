const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const MAX_PENDING=256*1024;
class HostTerminal {
  constructor({publish,environment,pty}){this.publish=publish;this.environment=environment;this.pty=pty;this.sessions=new Map();}
  library(){if(this.pty)return this.pty;const packaged=path.join(__dirname,'../resources/terminal/node-pty').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');return this.pty=fs.existsSync(packaged)?require(packaged):require(path.join(__dirname,'../node_modules/node-pty'));}
  shells(){return require('./terminal-shells.cjs').discoverShells(this.environment);}
  list(){return [...this.sessions.values()].map(s=>({id:s.id,pid:s.process.pid,title:s.title,cwd:s.cwd,exited:s.exited,exitCode:s.exitCode}));}
  get(id){const session=this.sessions.get(id);if(!session)throw Error('终端已关闭。');return session;}
  open({cwd,shell,args,cols=80,rows=24}={}){
    if(this.sessions.size>=6)throw Error('最多同时打开 6 个终端。');
    shell=shell|| (process.platform==='win32'?this.environment.ComSpec||this.environment.COMSPEC||'cmd.exe':this.environment.SHELL||'/bin/sh');args=args??[];
    if(typeof shell!=='string'||shell.length>32767||shell.includes('\0')||!Array.isArray(args)||args.length>64||args.some(a=>typeof a!=='string'||a.length>4000||a.includes('\0')))throw Error('终端程序或参数无效。');
    cwd=path.resolve(cwd||this.environment.USERPROFILE||this.environment.HOME||process.cwd());if(!fs.statSync(cwd).isDirectory())throw Error('终端工作目录无效。');
    const processPTY=this.library().spawn(shell,args,{name:'xterm-256color',cols:this.dimension(cols,500),rows:this.dimension(rows,500),cwd,env:{...this.environment,TERM:'xterm-256color',COLORTERM:'truecolor'},useConpty:true,useConptyDll:process.platform==='win32'});
    const id=crypto.randomUUID(),session={id,process:processPTY,title:path.basename(shell),cwd,output:'',history:'',offset:0,acknowledged:0,paused:false,exited:false,timer:null,exitCode:null};this.sessions.set(id,session);
    const flush=()=>{clearTimeout(session.timer);session.timer=null;if(!session.output)return;const data=session.output;session.output='';this.publish({type:'data',id,data,offset:session.offset});};
    session.data=processPTY.onData(data=>{session.history=(session.history+data).slice(-512*1024);session.output+=data;session.offset+=data.length;if(session.offset-session.acknowledged>MAX_PENDING&&!session.paused){processPTY.pause();session.paused=true;}if(!session.timer){session.timer=setTimeout(flush,16);session.timer.unref();}});
    session.exit=processPTY.onExit(({exitCode})=>{flush();session.exited=true;session.exitCode=exitCode;this.close(id);this.publish({type:'exit',id,exitCode});});
    return {id,pid:processPTY.pid,title:session.title,cwd};
  }
  dimension(value,max){if(!Number.isInteger(value)||value<1||value>max)throw Error('终端尺寸无效。');return value;}
  write({id,data}){const session=this.get(id);if(session.exited)throw Error('终端进程已退出。');if(typeof data!=='string'||data.length>65536)throw Error('终端输入过大。');session.process.write(data);}
  resize({id,cols,rows}){const session=this.get(id);if(!session.exited)session.process.resize(this.dimension(cols,500),this.dimension(rows,500));}
  acknowledge({id,offset}){const session=this.sessions.get(id);if(!session)return;if(!Number.isSafeInteger(offset)||offset<0||offset>session.offset)throw Error('终端输出确认无效。');session.acknowledged=Math.max(session.acknowledged,offset);if(session.paused&&session.offset-session.acknowledged<MAX_PENDING/2&&!session.exited){session.process.resume();session.paused=false;}}
  snapshot(id){const session=this.get(id);return {...this.list().find(s=>s.id===id),output:session.history,offset:session.offset};}
  close(id){const session=this.sessions.get(id);if(!session)return;this.sessions.delete(id);clearTimeout(session.timer);session.data?.dispose();session.exit?.dispose();if(!session.exited)session.process.kill();}
  closeAll(){for(const id of [...this.sessions.keys()])this.close(id);}
}
module.exports={HostTerminal};
