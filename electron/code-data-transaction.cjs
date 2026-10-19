const fs = require('node:fs/promises'), path = require('node:path');
const {internal, atomic, snapshot, eligible} = require('./files.cjs');
const {hash, fault} = require('./vault.cjs');
// One journal per vault, under its local application data, serialized by Vault.mutate.
class CodeDataTransaction {
  constructor(vault) { this.vault = vault; }
  async directory(create=false) { return create?internal(this.vault, 'code-transactions'):path.join(this.vault.dataDirectory||path.join(this.vault.root,'.data'),'code-transactions'); }
  async rollback(record, directory) {
    if (record.version !== 1 || !Array.isArray(record.files) || record.files.length > 128)
      throw fault('代码数据事务记录无效。');
    for (const [index, file] of record.files.entries()) {
      if (!eligible(file.path) || !/\/code-data\/(?:[a-f\d]{4}|SQL_GLOBAL)\//.test(file.path))
        throw fault('代码数据恢复路径无效。');
      const disk = await snapshot(this.vault, file.path), version = disk?.version || null;
      if (version === file.before) continue;
      if (version !== file.after) throw fault('代码数据恢复遇到外部修改：' + file.path, 'RECOVERY_CONFLICT');
      const target = await this.vault.resolve(file.path, true);
      if (file.before === null) await fs.unlink(target);
      else {
        const backup = path.join(directory, index + '.bin');
        const stat=await fs.lstat(backup);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>20*1024*1024)throw fault('代码数据备份无效或超过 20 MB。');
        const bytes = await fs.readFile(backup);
        if (hash(bytes) !== file.before) throw fault('代码数据备份校验失败。');
        await fs.mkdir(path.dirname(target), {recursive:true});
        await this.vault.resolve(file.path, true);
        await atomic(target, bytes);
      }
    }
  }
  async recover() {
    const directory = await this.directory(), file = path.join(directory, 'journal.json');
    if((await fs.lstat(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))?.isSymbolicLink())throw fault('代码数据事务目录不能是符号链接。');
    const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(stat&&(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024))throw fault('代码数据事务记录无效。');
    let record;
    try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if(record.version!==1||!Array.isArray(record.files)||record.files.length>128||!['working','complete'].includes(record.phase))throw fault('代码数据事务记录无效。');
    if (record.phase !== 'complete') await this.rollback(record, directory);
    await this.clear(directory, record);
  }
  async clear(directory, record) {
    await fs.unlink(path.join(directory, 'journal.json'));
    for (let index=0; index<record.files.length; index++)
      await fs.unlink(path.join(directory, index+'.bin')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  async write(changes) {
    await this.recover();
    const directory = await this.directory(true), journal = path.join(directory, 'journal.json');
    const record = {version:1, phase:'working', files:changes.map(file=>({path:file.path,before:file.previous?.version||null,after:file.next?hash(file.next):null}))};
    for (const [index,file] of changes.entries())
      if (file.previous) await atomic(path.join(directory,index+'.bin'),file.previous.bytes);
    await atomic(journal, JSON.stringify(record));
    try {
      for (const file of changes) {
        const disk = await snapshot(this.vault, file.path);
        if ((disk?.version||null)!==(file.previous?.version||null)) throw fault('数据文件已在外部修改：'+file.path,'CONFLICT');
        const target = await this.vault.resolve(file.path,true);
        if (file.next) { await fs.mkdir(path.dirname(target),{recursive:true});await this.vault.resolve(file.path,true);await atomic(target,file.next); }
        else await fs.unlink(target);
      }
      record.phase='complete'; await atomic(journal,JSON.stringify(record));
    } catch(error) {
      try { await this.rollback(record,directory);await this.clear(directory,record); }
      catch(recovery) { this.vault.recoveryError=error.message+'；'+recovery.message;throw fault(this.vault.recoveryError,'RECOVERY_CONFLICT'); }
      throw error;
    }
    await this.clear(directory,record);
  }
}
module.exports={CodeDataTransaction};
