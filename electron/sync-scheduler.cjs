const { policy } = require('./sync-policy.cjs');
const {automaticSyncGap}=require('../shared/sync-requests.mjs');
// One scheduler per open vault. Timers never save editor buffers.
class SyncScheduler {
  constructor(sync, finished = async () => {}) { this.sync = sync; this.finished = finished;this.lastStarted=-Infinity;this.paths=new Set(); }
  configure(config, opening = false) {
    this.close(); this.closed = false;
    this.settings = policy(config.sync); this.enabled = !!config.url;
    if (!this.enabled) return;
    if (opening && this.settings.onOpen) this.later(1500,true);
    if (this.settings.interval) {
      this.timer = setInterval(() => this.trigger(), this.settings.interval * 60000);
      this.timer.unref?.();
    }
  }
  changed(name) {
    if (!this.closed && this.enabled && this.settings.afterSave) {this.paths.add(name||'*');this.later(2000);}
  }
  later(ms,poll=false) {
    this.pollRequested ||= poll;
    this.requested = true;
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.trigger(false), Math.min(2147483647,ms)); this.pending.unref?.();
  }
  async trigger(poll=true) {
    if (this.closed || !this.enabled) return;
    this.pollRequested ||= poll;
    if (this.sync.job.phase === 'awaiting') { this.requested = false; return; }
    if (this.executing) { this.requested = true; return; }
    if (this.sync.running) {
      this.requested = true;
      if (this.waiting?.work !== this.sync.running) {
        const waiting = { work: this.sync.running, generation: this.generation };
        this.waiting = waiting;
        const settled = () => {
          if (this.waiting === waiting) this.waiting = null;
          if (!this.closed && this.generation === waiting.generation && this.requested) this.later(2000);
        };
        void Promise.resolve(waiting.work).then(settled, settled);
      }
      return;
    }
    const ready=Math.max(this.lastStarted+automaticSyncGap,(this.sync.lastStarted??-Infinity)+automaticSyncGap,this.sync.budget?.retryAt||0);
    if(ready>Date.now()){this.later(ready-Date.now());return;}
    this.requested = false;
    const generation = this.generation;
    this.executing = true;
    const paths=this.paths;this.paths=new Set();const shouldPoll=this.pollRequested;this.pollRequested=false;
    try {
      if(!shouldPoll&&this.sync.hasLocalChanges&&!await this.sync.hasLocalChanges(paths))return;
      if(this.closed||this.generation!==generation)return;
      this.lastStarted=Date.now();
      const result = await this.sync.sync({ automatic: true });
      if (!this.closed && this.generation === generation) {
        if (result.needsConfirmation) this.requested = false;
        else await this.finished(result);
      }
    } catch(error) {if(error.code==='RATE_LIMITED'){this.requested=true;this.pollRequested ||= shouldPoll;for(const name of paths)this.paths.add(name);} /* The sync service publishes errors. */ }
    finally { this.executing = false; if (!this.closed && this.requested) this.later(2000); }
  }
  close() { this.closed = true; this.generation = (this.generation || 0) + 1; this.requested = false; this.pollRequested=false;this.paths?.clear();this.waiting = null; clearTimeout(this.pending); clearInterval(this.timer); }
}
module.exports = { SyncScheduler };
