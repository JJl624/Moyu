const { ApplicationConfig } = require('./application-config.cjs');
const { fault } = require('./vault.cjs');
const {DATA_FOLDER}=require('./vault-paths.cjs');
class DataStore {
  constructor(directory) { this.directory = directory; this.config = new ApplicationConfig(directory); this.queue = Promise.resolve(); }
  get() { return this.config.get('values'); }
  set({ key, value }) {
    return this.setMany({values:{[key]:value}});
  }
  setMany({values: patches}) {
    if (!patches || typeof patches !== 'object' || Array.isArray(patches) || Object.keys(patches).length > 128) throw fault('设置格式无效。');
    for (const [key,value] of Object.entries(patches))
      if (!key.startsWith('moyu-') || key.length > 2048 || typeof value !== 'string' || Buffer.byteLength(value) > 2 * 1024 * 1024) throw fault('设置格式无效。');
    const job = this.config.update('values', values => {
      for (const [key,value] of Object.entries(patches)) {
        if (values[key] === value) continue;
        Object.defineProperty(values, key, { value, enumerable: true, configurable: true, writable: true });
      }
      return values;
    }).then(() => {});
    this.queue = job.catch(() => {}); return job;
  }
  remove(key){const job=this.config.update('values',values=>{delete values[key];return Object.keys(values).length ? values : undefined;}).then(()=>{});this.queue=job.catch(()=>{});return job;}
}
module.exports = { DATA_FOLDER, DataStore };
