const semver=require('semver');
const series=['4.0','3.4','3.3','3.2'];
function rubyVersion(value){const match=/^(3\.[234])\.0-(\d+\.\d+\.\d+)$/.exec(value);return match?{series:match[1],build:match[2],package:'@ruby/'+match[1]+'-wasm-wasi'}:{series:'4.0',build:value,package:'@ruby/4.0-wasm-wasi'};}
function rubyLabel(value){const runtime=rubyVersion(value);return 'Ruby '+runtime.series+'（构建 '+runtime.build+'）';}
async function rubyVersions(npm,job){const versions=[];for(const version of series){job.phase('读取 Ruby '+version+' 版本');for(const build of await npm.versions('@ruby/'+version+'-wasm-wasi'))if(semver.gte(build,'2.7.2'))versions.push(version==='4.0'?build:version+'.0-'+build);}return versions;}
module.exports={rubyVersion,rubyLabel,rubyVersions};
