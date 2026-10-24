import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const tag=process.env.RELEASE_TAG,run=process.env.BUILD_RUN_ID,repository=process.env.GITHUB_REPOSITORY;
if(!/^v\d+\.\d+\.\d+$/.test(tag||'')||!/^\d+$/.test(run||'')||repository!=='JJl624/Moyu'||!process.env.GH_TOKEN)throw Error('Release inputs or credentials are missing.');
const headers={Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
async function api(endpoint){const response=await fetch('https://api.github.com/repos/'+repository+endpoint,{headers,signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('GitHub HTTP '+response.status);return response.json();}
const expected=execFileSync('git',['rev-parse',tag+'^{commit}'],{encoding:'utf8'}).trim(),build=await api('/actions/runs/'+run);
if(build.head_sha!==expected||build.conclusion!=='success'||build.event!=='workflow_dispatch'||!build.path.endsWith('/linux-release.yml'))throw Error('Linux build does not match the verified release tag.');
const version=JSON.parse(execFileSync('git',['show',tag+':package.json'],{encoding:'utf8'})).version;
if(tag!=='v'+version)throw Error('Tag and package versions differ.');
console.log('Verified Linux build '+run+' at '+expected);
if(process.argv.includes('--verify-run'))process.exit(0);

const names=['Moyu-'+version+'-x86_64.AppImage','Moyu-'+version+'-amd64.deb'],files=new Map();
async function walk(folder,depth=0){if(depth>4)throw Error('Unexpected artifact layout.');for(const entry of await fsp.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file,depth+1);else{if(!entry.isFile()||![...names,'SHA256SUMS-linux.txt'].includes(entry.name)||files.has(entry.name))throw Error('Unexpected artifact file.');files.set(entry.name,file);}}}
await walk(path.resolve('linux-artifact'));
if(files.size!==3)throw Error('Linux packages are incomplete.');
const checksums=new Map((await fsp.readFile(files.get('SHA256SUMS-linux.txt'),'utf8')).trim().split(/\r?\n/).map(line=>{const match=line.match(/^([a-f0-9]{64})\s+\*?(?:\.\/)?([^/]+)$/);if(!match)throw Error('Invalid checksums.');return[match[2],match[1]];}));
async function digest(file){const hash=createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex');}
const release=(await api('/releases?per_page=100')).find(item=>item.tag_name===tag);
if(!release?.draft)throw Error('Only an unpublished draft can receive packages.');
for(const name of names){
  const file=files.get(name),hash=await digest(file),size=(await fsp.stat(file)).size;
  if(checksums.get(name)!==hash)throw Error('Linux checksum differs: '+name);
  const existing=release.assets.find(asset=>asset.name===name);
  if(existing){if(existing.state!=='uploaded'||existing.digest!=='sha256:'+hash||existing.size!==size)throw Error('Existing asset differs: '+name);console.log('Verified existing '+name);continue;}
  const url=new URL(release.upload_url.replace(/\{.*$/,''));if(url.origin!=='https://uploads.github.com')throw Error('Invalid upload host.');url.searchParams.set('name',name);
  const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(size)},body:fs.createReadStream(file),duplex:'half',signal:AbortSignal.timeout(1200000)}),asset=await response.json();
  if(!response.ok||asset.state!=='uploaded'||asset.size!==size||asset.digest!=='sha256:'+hash)throw Error('Upload verification failed: '+name);
  console.log('Uploaded '+name+' sha256:'+hash+' '+size);
}
