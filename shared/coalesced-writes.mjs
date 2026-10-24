// Keep recovery writes off the typing path. Explicit lifecycle flushes wait for
// in-flight work; discarded documents cannot be resurrected by an older timer.
export class CoalescedWrites {
  constructor(write,{delay=350,maxWait=1500,report=()=>{}}={}) {
    Object.assign(this,{write,delay,maxWait,report});this.pending=new Map();this.active=new Set();this.tail=Promise.resolve();
  }
  set(key,value) {
    let job=this.pending.get(key);
    if(!job){job={key,value,first:Date.now(),waiters:[]};this.pending.set(key,job);}
    job.value=value;clearTimeout(job.timer);
    job.timer=setTimeout(()=>{void this.flush().catch(this.report);},Math.max(0,Math.min(this.delay,this.maxWait-(Date.now()-job.first))));
    return new Promise((resolve,reject)=>job.waiters.push({resolve,reject}));
  }
  async flush() {
    await this.tail;
    const jobs=[...this.pending.values()];this.pending.clear();
    if(!jobs.length)return this.tail;
    for(const job of jobs){clearTimeout(job.timer);this.active.add(job);}
    const task=(async()=>{
      let failure;
      for(const job of jobs){
        try{if(!job.cancelled)await this.write(job.value);for(const waiter of job.waiters)waiter.resolve(!job.cancelled);}
        catch(error){failure ||= error;for(const waiter of job.waiters)waiter.reject(error);if(!job.cancelled&&!this.pending.has(job.key))this.pending.set(job.key,{...job,first:Date.now(),waiters:[],timer:undefined});}
        finally{this.active.delete(job);}
      }
      if(failure)throw failure;
    })();
    this.tail=task.catch(()=>{});return task;
  }
  async discard(matches) {
    for(const [key,job] of this.pending)if(matches(job.value)){clearTimeout(job.timer);this.pending.delete(key);for(const waiter of job.waiters)waiter.resolve(false);}
    for(const job of this.active)if(matches(job.value))job.cancelled=true;
    await this.tail;
  }
}
