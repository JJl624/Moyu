import { api } from './bridge';
let values: Record<string, string> = {};
let pending = Promise.resolve();
const changed=new Map<string,string>();let timer:ReturnType<typeof setTimeout>|undefined;
function drain(){clearTimeout(timer);timer=undefined;const batch=[...changed];changed.clear();if(!batch.length)return pending;
  const task=pending.then(async()=>{await api.feature('preferences.set-many',{values:Object.fromEntries(batch)});});
  pending=task.catch(error=>{
    // Retain failed writes for an explicit flush, without replacing newer edits
    // or repeatedly retrying a full/read-only disk in the background.
    for(const [key,value] of batch)if(values[key]===value&&!changed.has(key))changed.set(key,value);
    window.dispatchEvent(new CustomEvent('moyu-storage-error',{detail:error.message}));
  });return task;
}
export async function hydrateSettings() {
  if (api.desktop) values = await api.feature<Record<string, string>>('preferences.get');
}
export const settingsStore = {
  getItem(key: string) { return api.desktop ? values[key] ?? null : localStorage.getItem(key); },
  setItem(key: string, value: string) {
    if (!api.desktop) { localStorage.setItem(key, value); return; }
    if (values[key] === value) return;
    values[key] = value;
    changed.set(key,value);clearTimeout(timer);timer=setTimeout(()=>{void drain().catch(()=>{});},250);
  },
  acceptItem(key:string,value:string){if(api.desktop){values[key]=value;changed.delete(key);}else localStorage.setItem(key,value);},
  async flush() {
    clearTimeout(timer); timer = undefined;
    // An in-flight background failure requeues its values before settling.
    // Observe that queue before declaring the explicit save complete.
    await pending;
    while (changed.size) await drain();
  },
};
