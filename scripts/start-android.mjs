import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const project=path.resolve(import.meta.dirname,'..');
const execute=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const binary=name=>name+(process.platform==='win32'?'.exe':'');
const resolve=value=>value?path.resolve(project,value):'';
export const outputLines=text=>text.split(/[\r\n]+/).map(line=>line.trim()).filter(Boolean);
export const emulatorSerials=text=>outputLines(text).flatMap(line=>line.match(/^(emulator-\d+)\s+device$/)?.[1]||[]);
export function accelerationStatus(text){
  const lines=outputLines(text),index=lines.indexOf('accel:');
  const code=index>=0&&/^\d+$/.test(lines[index+1]||'')?Number(lines[index+1]):null;
  return {available:code===null?null:code===0,detail:(index>=0?lines.slice(index+2).filter(line=>line!=='accel'):lines).join(' ')};
}
export function accelerationMode(requested,status,platform=process.platform){
  if(!['auto','on','off'].includes(requested))throw Error('加速方式只能是 auto、on 或 off。');
  if(requested!=='off'&&status.available===false)throw Error('虚拟化加速不可用：'+status.detail+'\n'+(platform==='win32'?'请先启用“Windows 虚拟机监控程序平台”，重启电脑后再运行。':'请先配置系统虚拟化加速后再运行。'));
  return requested;
}
export function emulatorExitDetail(text){
  return outputLines(text).filter(line=>/^(?:ERROR|FATAL|PANIC)\b|CPU acceleration status:|Critical:|Showing crashdialog/i.test(line)).slice(-3).join('\n');
}
async function available(port){
  return new Promise(done=>{const server=net.createServer();server.once('error',()=>done(false));server.listen(port,'127.0.0.1',()=>server.close(()=>done(true)));});
}
async function main(){
  const {values}=parseArgs({options:{apk:{type:'string'},avd:{type:'string'},accel:{type:'string'}}});
  const configFile=path.join(project,'android/emulator.local.json');
  const config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
  const sdk=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,resolve(config.sdk),
    path.join(os.homedir(),'AppData/Local/Android/Sdk'),path.join(os.homedir(),'Android/Sdk'),path.join(os.homedir(),'Library/Android/sdk')]
    .find(candidate=>candidate&&fs.existsSync(path.join(candidate,'platform-tools',binary('adb'))));
  if(!sdk)throw Error('找不到 Android SDK。请设置 ANDROID_HOME，或在 android/emulator.local.json 中填写 sdk。');
  const adb=path.join(sdk,'platform-tools',binary('adb'));
  const emulator=resolve(config.emulator)||path.join(sdk,'emulator',binary('emulator'));
  if(!fs.existsSync(emulator))throw Error('找不到模拟器程序：'+emulator);
  const avd=values.avd||process.env.MOYU_ANDROID_AVD||config.avd||'MoyuPhone';
  if(!/^[a-zA-Z0-9._-]+$/.test(avd))throw Error('模拟器名称无效。');
  const avdHome=process.env.ANDROID_AVD_HOME||resolve(config.avdHome)||path.join(os.homedir(),'.android/avd');
  const userHome=process.env.ANDROID_USER_HOME||resolve(config.userHome)||path.dirname(avdHome);
  const env={...process.env,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ANDROID_AVD_HOME:avdHome,ANDROID_USER_HOME:userHome};
  const runAdb=async args=>(await execute(adb,args,{env,windowsHide:true,timeout:15000,maxBuffer:2*1024*1024})).stdout.trim();
  let apk=values.apk?path.resolve(values.apk):'';
  if(!apk){
    const releases=path.join(project,'release/android'),candidates=[];
    if(fs.existsSync(releases))for(const directory of fs.readdirSync(releases,{withFileTypes:true}).filter(entry=>entry.isDirectory())){
      for(const name of fs.readdirSync(path.join(releases,directory.name)))if(/^Moyu-Android-[\d.]+\.apk$/.test(name))candidates.push({name,path:path.join(releases,directory.name,name)});
    }
    candidates.sort((a,b)=>b.name.localeCompare(a.name,'en',{numeric:true}));apk=candidates[0]?.path||'';
  }
  if(!apk||!fs.existsSync(apk))throw Error('找不到 Android 安装包。请先运行 npm run dist:android，或用 --apk 指定 APK。');
  const list=outputLines((await execute(emulator,['-list-avds'],{env,windowsHide:true,timeout:15000})).stdout);
  if(!list.includes(avd))throw Error('找不到模拟器 '+avd+'。可用模拟器：'+list.filter(Boolean).join('、'));
  await runAdb(['start-server']);
  let serial='';
  for(const candidate of emulatorSerials(await runAdb(['devices']))){
    try{if(outputLines(await runAdb(['-s',candidate,'emu','avd','name']))[0]===avd){serial=candidate;break;}}catch{}
  }
  let startupError;
  let software=false;
  if(!serial){
    let check;try{check=(await execute(emulator,['-accel-check'],{env,windowsHide:true,timeout:15000})).stdout;}catch(error){check=[error.stdout,error.stderr].filter(Boolean).join('\n');if(!check)throw error;}
    const acceleration=accelerationMode(values.accel||config.acceleration||'auto',accelerationStatus(check));
    software=acceleration==='off';
    if(software)console.log('使用软件模拟；部分系统镜像不支持此模式，启动和运行会较慢。');
    let port;for(let candidate=5580;candidate<5660;candidate+=2)if(await available(candidate)&&await available(candidate+1)){port=candidate;break;}
    if(!port)throw Error('模拟器端口被占用，请关闭不用的模拟器后重试。');
    serial='emulator-'+port;
    const logs=resolve(config.logDirectory)||path.join(os.tmpdir(),'moyu-android');fs.mkdirSync(logs,{recursive:true});
    const log=path.join(logs,avd+'.log'),fd=fs.openSync(log,'w');
    console.log('正在启动 '+avd+'，首次启动可能需要一两分钟…');
    const child=spawn(emulator,['-avd',avd,'-port',String(port),'-gpu','swiftshader','-accel',acceleration,'-no-snapshot','-no-boot-anim'],{
      env,cwd:path.dirname(emulator),detached:true,windowsHide:false,stdio:['ignore',fd,fd],
    });
    child.once('error',error=>{startupError=error;});
    child.once('exit',code=>{let detail='';try{detail=emulatorExitDetail(fs.readFileSync(log,'utf8'));}catch{}startupError=Error('模拟器退出（'+code+'）。'+(detail?'\n'+detail:'')+'\n日志：'+log);});
    child.unref();fs.closeSync(fd);
  }else console.log('使用已运行的 '+avd+'。');
  let ready=false;const deadline=Date.now()+(software?600000:180000);let nextProgress=Date.now()+15000;
  while(Date.now()<deadline){
    if(startupError)throw startupError;
    try{if(await runAdb(['-s',serial,'shell','getprop','sys.boot_completed'])==='1'){ready=true;break;}}catch{}
    if(Date.now()>nextProgress){console.log('正在等待 Android 启动…');nextProgress=Date.now()+15000;}
    await sleep(2000);
  }
  if(!ready)throw Error('等待 Android 启动超时。模拟器窗口仍会保留，请启动完成后再次运行脚本。');
  console.log('正在安装 '+path.basename(apk)+'…');
  try{await execute(adb,['-s',serial,'install','-r',apk],{env,windowsHide:true,timeout:120000});}
  catch(error){const detail=(error.stderr||'')+' '+(error.stdout||'');if(detail.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE'))throw Error('已有墨屿使用了不同签名。请在模拟器中备份笔记并卸载旧版后，再运行此脚本。');throw Error('安装失败：'+detail.trim());}
  await runAdb(['-s',serial,'shell','input','keyevent','KEYCODE_WAKEUP']);
  await runAdb(['-s',serial,'shell','wm','dismiss-keyguard']);
  const started=await runAdb(['-s',serial,'shell','am','start','-W','-n','app.moyu.notes/.MainActivity']);
  if(/Error:|Exception|Status: timeout/.test(started))throw Error('无法打开墨屿：'+started);
  console.log('墨屿已打开。关闭模拟器窗口即可退出；下次启动会保留笔记。');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('\n'+error.message);process.exitCode=1;});
