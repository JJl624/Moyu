const fs=require('node:fs/promises'),path=require('node:path');
async function discoverShells(environment=process.env,platform=process.platform){
 const windows=platform==='win32',folders=String(environment.Path||environment.PATH||'').split(windows?';':':').filter(Boolean),windir=environment.SystemRoot||environment.WINDIR||'C:\\Windows',programs=environment.ProgramFiles||'C:\\Program Files';
 const specs=windows?[
  ['cmd','命令提示符','cmd.exe',[],[environment.ComSpec||environment.COMSPEC,path.join(windir,'System32/cmd.exe')]],
  ['powershell','Windows PowerShell','powershell.exe',['-NoLogo','-NoProfile'],[path.join(windir,'System32/WindowsPowerShell/v1.0/powershell.exe')]],
  ['pwsh','PowerShell','pwsh.exe',['-NoLogo','-NoProfile'],[path.join(programs,'PowerShell/7/pwsh.exe')]],
  ['git-bash','Git Bash','bash.exe',['--login','-i'],[path.join(programs,'Git/bin/bash.exe'),path.join(environment['ProgramFiles(x86)']||programs,'Git/bin/bash.exe')]],
 ]:[['zsh','Zsh','zsh',['-l'],['/bin/zsh','/usr/bin/zsh']],['bash','Bash','bash',['-l'],['/bin/bash','/usr/bin/bash']],['fish','Fish','fish',[],['/usr/bin/fish','/usr/local/bin/fish']],['sh','Sh','sh',[],['/bin/sh']]];
 const result=[];for(const [id,label,file,args,known]of specs){for(const candidate of [...known,...folders.map(folder=>path.join(folder,file))].filter(Boolean)){try{if((await fs.stat(candidate)).isFile()){result.push({id,label,shell:path.resolve(candidate),arguments:args});break;}}catch{}}}
 if(!windows&&environment.SHELL&&!result.some(p=>p.shell===environment.SHELL)){try{if((await fs.stat(environment.SHELL)).isFile())result.unshift({id:'login-shell',label:path.basename(environment.SHELL),shell:environment.SHELL,arguments:[]});}catch{}}
 if(windows){const wsl=path.join(windir,'System32/wsl.exe');try{if((await fs.stat(wsl)).isFile()){const {execFile}=require('node:child_process'),text=await new Promise((resolve,reject)=>execFile(wsl,['--list','--quiet'],{windowsHide:true,timeout:2500,encoding:'utf16le',env:environment,maxBuffer:65536},(error,output)=>error?reject(error):resolve(output)));for(const [index,name]of text.split(/\r?\n/).map(s=>s.replaceAll('\0','').trim()).filter(Boolean).entries())result.push({id:'wsl-'+index,label:'WSL（'+name+'）',shell:wsl,arguments:['--distribution',name]});}}catch{}}
 return result;
}
module.exports={discoverShells};
