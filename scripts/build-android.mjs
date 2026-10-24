import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),android=path.join(root,'android');
const mobileBuild=JSON.parse(await fs.readFile(path.join(root,'shared/mobile-build.json'),'utf8'));
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(mobileBuild.version!==pkg.version)throw Error('Android and desktop versions must match.');
const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
async function run(command,args,options={}) {
  const child=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true,...options});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error(command+' exited with '+code);
}
if(!process.env.ANDROID_HOME&&!process.env.ANDROID_SDK_ROOT)throw Error('Set ANDROID_HOME to an installed Android SDK (platform 36, build-tools 35.0.0).');
await run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit']);
await run(process.execPath,['node_modules/vite/bin/vite.js','build','--config','vite.mobile.config.ts','--logLevel','warn']);
await fs.cp(path.join(root,'public/excalidraw'),path.join(android,'app/src/main/assets/web/excalidraw'),{recursive:true});
await fs.cp(path.join(root,'public/file-icons'),path.join(android,'app/src/main/assets/web/file-icons'),{recursive:true});
await fs.mkdir(path.join(android,'app/src/main/assets/guides'),{recursive:true});
await fs.copyFile(path.join(android,'guide.md'),path.join(android,'app/src/main/assets/guides/开始使用.md'));
const signing=path.join(android,'signing'),properties=path.join(signing,'moyu-release.properties');
try{await fs.access(properties);}catch{
  await fs.mkdir(signing,{recursive:true});
  const keyFile=path.join(signing,'moyu-release.jks');
  try{await fs.access(keyFile);throw Error('The Android signing key exists but its properties are missing. Restore the matching properties before building.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const secret=crypto.randomBytes(32).toString('hex'),keytool=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'keytool.exe':'keytool'):'keytool';
  await run(keytool,['-genkeypair','-alias','moyu','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Moyu Android','-keystore',keyFile,'-storepass:env','MOYU_KEY_PASSWORD','-keypass:env','MOYU_KEY_PASSWORD'],{env:{...process.env,MOYU_KEY_PASSWORD:secret}});
  await fs.writeFile(properties,`storePassword=${secret}\nkeyPassword=${secret}\n`,{mode:0o600});
}
const tasks=process.argv.includes('--debug')?[':app:assembleDebug',':app:assembleDebugAndroidTest',':app:testDebugUnitTest']:[':app:assembleRelease',':app:testReleaseUnitTest'];
await run(java,['-classpath',path.join(android,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain','--no-daemon','--console=plain',...(process.argv.includes('--offline')?['--offline']:[]),...tasks],{cwd:android});
if(!process.argv.includes('--debug')){
  const output=path.join(root,'release/android/v'+mobileBuild.version),name='Moyu-Android-'+mobileBuild.version+'.apk';await fs.mkdir(output,{recursive:true});
  const target=path.join(output,name);await fs.copyFile(path.join(android,'app/build/outputs/apk/release/app-release.apk'),target);
  const hash=crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex');await fs.writeFile(path.join(output,'SHA256SUMS.txt'),hash+'  '+name+'\n');
  console.log('Android APK:',target);
}
