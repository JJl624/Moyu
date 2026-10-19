const fs=require('node:fs/promises'),path=require('node:path');
async function removeExportHistory(root){const file=path.join(root,'exports.json');try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>1024*1024)return;const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.version===1&&Array.isArray(value.files)&&value.files.every(item=>typeof item.path==='string'))await fs.unlink(file);}catch(error){if(['ENOENT','EACCES','EPERM','EBUSY'].includes(error.code)||error instanceof SyntaxError)return;throw error;}}
module.exports={removeExportHistory};
