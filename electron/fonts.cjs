const {execFile}=require('node:child_process');
let cached;
function systemFonts(refresh=false) {
  if(refresh)cached=undefined;
  if(cached)return cached;
  if(process.platform==='linux'){
    cached=new Promise((resolve,reject)=>execFile('fc-list',['--format=%{family}\n'],{timeout:15000,maxBuffer:4*1024*1024},(error,stdout)=>{
      if(error){cached=undefined;reject(new Error('系统字体列表读取失败。'));return;}
      resolve([...new Set(stdout.split(/[,\r\n]/).map(name=>name.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)));
    }));
    return cached;
  }
  if(process.platform!=='win32')return Promise.resolve([]);
  // WPF returns localized family names as well as English DirectWrite names.
  const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName PresentationCore; @([Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source; $_.FamilyNames.Values } | Sort-Object -Unique) | ConvertTo-Json -Compress";
  cached=new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,maxBuffer:1024*1024},(error,stdout)=>{if(error){cached=undefined;reject(new Error('系统字体列表读取失败。'));return;}try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{cached=undefined;reject(new Error('系统字体列表格式无效。'));}}));
  return cached;
}
module.exports={systemFonts};
