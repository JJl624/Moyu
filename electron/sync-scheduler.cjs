const { policy } = require('./sync-policy.cjs');
// One scheduler per open vault. Timers never save editor buffers.
class SyncScheduler {
  constructor(sync, finished = async () => {}) { this.sync = sync; this.finished = finished; }
  configure(config, opening = false) {
    this.close(); this.closed = false;
    this.settings = policy(config.sync); this.enabled = !!config.url;
    if (!this.enabled) return;
    if (opening && this.settings.onOpen) this.later(1500);
    if (this.settings.interval) {
      this.timer = setInterval(() => this.trigger(), this.settings.interval * 60000);
      this.timer.unref?.();
    }
  }
  changed() {
    if (this.enabled && this.settings.afterSave && !this.sync.running && !this.executing) this.later(2000);
  }
  later(ms) {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.trigger(), ms); this.pending.unref?.();
  }
  async trigger() {
    if (this.closed || !this.enabled || this.executing || this.sync.running || this.sync.job.phase === 'awaiting') return;
    this.executing = true;
    try {
      const result = await this.sync.sync({ automatic: true });
      if (!this.closed && !result.needsConfirmation) await this.finished(result);
    } catch { /* The sync service publishes the error; automatic tasks do not open dialogs. */ }
    finally { this.executing = false; }
  }
  close() { this.closed = true; clearTimeout(this.pending); clearInterval(this.timer); }
}
module.exports = { SyncScheduler };
