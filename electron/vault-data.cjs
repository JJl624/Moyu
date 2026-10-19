const fs=require('node:fs/promises');
const path=require('node:path');
const {fault}=require('./vault.cjs');
const {DATA_FOLDER}=require('./vault-paths.cjs');
async function configureVaultData(vault){
  vault.dataDirectory=path.join(vault.root,DATA_FOLDER);
  const legacy=path.join(vault.root,'Moyu数据'),old=await fs.lstat(legacy).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(old){
    if(old.isSymbolicLink()||!old.isDirectory())throw fault('原知识库数据目录无效。');
    if(await fs.lstat(vault.dataDirectory).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))throw fault('知识库同时存在 Moyu数据 和 .data，请先在资源管理器中处理重复目录。');
    await fs.rename(legacy,vault.dataDirectory);
  }
  await fs.mkdir(vault.dataDirectory,{recursive:true});
  const stat=await fs.lstat(vault.dataDirectory);if(stat.isSymbolicLink()||!stat.isDirectory())throw fault('知识库数据目录无效。');
}
module.exports={configureVaultData};
