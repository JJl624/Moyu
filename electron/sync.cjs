const fs = require('node:fs/promises');
const native = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { hash, fault } = require('./vault.cjs');
const { eligible, internal } = require('./files.cjs');
const { SyncState } = require('./sync-state.cjs');
const { readTree, saveTree } = require('./sync-tree.cjs');
const { policy, excludedBy } = require('./sync-policy.cjs');
const { fingerprint, info, digest, localFiles, download, apply, conflictCopy } = require('./sync-files.cjs');
const limit = settings => settings.maxFileMB * 1024 * 1024;
const { validator:etag, sameToken } = require('./sync-validator.cjs');
const {requestBudget}=require('../shared/sync-requests.mjs');
const localMeta = item => item ? { ...fingerprint(item), version: item.version } : null;
const remoteMeta = item => item ? { etag: item.etag, size: item.size, version: item.version } : null;
class WebDAVSync {
  constructor(vault, config, options = {}) {
    this.vault = vault; this.config = config; this.options = options;
    this.job = { phase: 'idle', completed: 0, total: 0 }; this.localCache = {};
  }
  progress(value) {
    const phase = this.job.phase;
    this.job = { ...this.job, ...value };
    if (phase !== this.job.phase || Date.now() - (this.published || 0) >= 100) {
      this.published = Date.now(); this.options.onProgress?.({ root: this.vault.root, ...this.job });
    }
  }
  async client() {
    const config = await this.config();
    if (!config.url) throw fault('请先配置 WebDAV 地址。');
    const { createClient } = await import('webdav');
    const client = createClient(config.url, { username: config.username, password: config.password });
    this.budget=requestBudget(config.url,config.username);
    client.registerTagParser((name,value)=>name.endsWith('propstat.prop.getetag') ? undefined : value);
    return { client,
      root: config.directory || '/Moyu', settings: policy(config.sync),
      identity: hash(config.url + '\n' + config.directory + '\n' + config.username),
      configuration: hash(JSON.stringify([config.url, config.directory, config.username, config.password, policy(config.sync)])) };
  }
  async request(action, settings, externalSignal) {
    for (let attempt = 0;; attempt++) {
      this.controller?.signal.throwIfAborted();
      externalSignal?.throwIfAborted();
      const wait=this.budget?.reserve()||0;
      if(wait)await delay(wait,undefined,{signal:externalSignal?AbortSignal.any([externalSignal,...(this.controller?[this.controller.signal]:[])]):this.controller?.signal});
      this.budget?.check();
      const signal = AbortSignal.any([AbortSignal.timeout(settings.timeout * 1000), ...(this.controller ? [this.controller.signal] : []),...(externalSignal?[externalSignal]:[])]);
      try { const result=await action({ signal });this.budget?.success();return result; }
      catch (error) {
        externalSignal?.throwIfAborted();
        if (this.controller?.signal.aborted) throw this.cancelRequested ? fault('同步已取消。', 'CANCELLED') : this.controller.signal.reason;
        const retryAfter=error.response?.headers?.get?.('retry-after');
        if(error.status===429||error.status===503&&(retryAfter||attempt>=settings.retries))throw this.budget.limited(error.status,retryAfter);
        if (attempt >= settings.retries || error.status && ![408, 500, 502, 503, 504].includes(error.status)) throw error;
        await delay((error.status===503?2000:800) * 2 ** attempt, undefined, { signal: externalSignal?AbortSignal.any([externalSignal,...(this.controller?[this.controller.signal]:[])]):this.controller?.signal });
      }
    }
  }
  explain(error) {
    if (error.code === 'CANCELLED' || this.cancelRequested && this.controller?.signal.aborted) return fault('同步已取消。', 'CANCELLED');
    const labels = { 401: '用户名或密码错误。', 403: '没有访问或写入远端目录的权限。', 404: '远端文件或目录不存在，请重新扫描。', 412: '远端文件已改变，请重新同步。', 507: '远端存储空间不足。' };
    if (labels[error.status]) return fault(labels[error.status]+(error.file ? '\n'+error.file : ''), error.status === 412 ? 'CONFLICT' : 'WEBDAV');
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return fault('连接超时，请检查网络或调整超时时间。', 'WEBDAV');
    return error;
  }
  async test(externalSignal) {
    const { client, root, settings } = await this.client();
    try {
      let directory=root;
      for(;;){
        try{await this.request(o=>client.getDirectoryContents(directory,o),settings,externalSignal);return {message:directory===root?'连接成功':'连接成功，同步时将创建远端目录',exists:directory===root};}
        catch(error){if(error.status!==404)throw error;const parent=path.posix.dirname(directory);if(parent===directory)throw error;directory=parent;}
      }
    } catch (error) { throw this.explain(error); }
  }
  async ensureDirectory(client, directory, known, settings) {
    if (known.has(directory)) return;
    if (!(await this.request(o => client.exists(directory, o), settings))) {
      const parent = path.posix.dirname(directory);
      if (parent !== directory) await this.ensureDirectory(client, parent, known, settings);
      await this.request(o => client.createDirectory(directory, o), settings);
      const relative=path.posix.relative(this.plan?.context.root||directory,directory);if(relative&&!relative.startsWith('..'))this.plan?.tree?.set(relative,{path:relative,type:'folder',size:0});
    }
    known.add(directory);
  }
  async stateFile(identity) { return path.join(await internal(this.vault, 'sync'), identity + '.json'); }
  async state(identity) { return new SyncState(await this.stateFile(identity)).read(); }
  async status() {
    const config = await this.config();
    if (!config.url) return { enabled: false, lastSync: 0, conflicts: [], files: {}, job: this.job };
    const { identity, settings } = await this.client(), state = await this.state(identity);
    const local = await localFiles(this.vault, excludedBy(settings), limit(settings), this.localCache);
    this.localCache = Object.fromEntries(Object.entries(local.files).map(([name, item]) => [name, localMeta(item)]));
    const conflicts = new Set((state.conflicts || []).map(c => c.path));
    const files = Object.fromEntries(Object.entries(local.files).map(([name, item]) => [name,
      conflicts.has(name) ? 'conflict' : !state.base[name] ? 'local' : state.base[name] === item.version ? 'synced' : 'pending']));
    for (const item of local.skipped) files[item.path] = 'excluded';
    return { enabled: true, lastSync: state.lastSync, conflicts: state.conflicts || [], files,
      job: this.job, report: state.report || null, cloud: await readTree(await this.stateFile(identity)) };
  }
  async remote(context, state, excluded, blocked, inspect = false, first) {
    const { client, root, settings } = context, files = Object.create(null), skipped = [], entries = [];
    let count = 0;
    const visit = async (dir, prefix = '', depth = 0) => {
      if (depth > 30) throw fault('远端目录层级超过 30 层。');
      const listing = depth===0&&first ? first : await this.request(o => client.getDirectoryContents(dir, {...o,details:true}), settings);
      const items = listing.data;
      for (const item of items) {
        if (!item.basename || item.basename.includes('/')) throw fault('远端返回了无效文件名。');
        if (['.', '..'].includes(item.basename) || /[\\\x00-\x1f]/.test(item.basename)) throw fault('远端返回了无效文件名。');
        const name = prefix + item.basename;
        if (entries.length >= 20000) throw fault('远端条目数量超过 20000。');
        const reason = !eligible(name) || item.basename.startsWith('moyu-tmp-') ? '不同步' : excluded(name) ? '已排除' : item.size > limit(settings) ? '超过单文件限制' : undefined;
        const modified = Date.parse(item.lastmod);
        const created = Date.parse(item.props?.creationdate);
        entries.push({path:name, type:item.type === 'directory' ? 'folder' : 'file', size:Number.isFinite(item.size) ? item.size : 0, ...(Number.isFinite(modified) ? {modified} : {}), ...(Number.isFinite(created) ? {created} : {}), ...(reason ? {excluded:reason} : {})});
        if (!eligible(name) || item.basename.startsWith('moyu-tmp-')) {
          if (inspect && item.type === 'directory') await visit(path.posix.join(root,name),name+'/',depth+1);
          continue;
        }
        if (item.type === 'directory') {if(!excluded(name)||inspect)await visit(path.posix.join(root, name), name + '/', depth + 1);}
        else {
          if (++count > 10000) throw fault('远端文件数量超过 10000。');
          if (excluded(name)) { skipped.push({ path: name, reason: '已排除' }); blocked.add(name); continue; }
          if (item.size > limit(settings)) { skipped.push({ path: name, reason: '超过单文件限制' }); blocked.add(name); continue; }
          if (blocked.has(name)) continue;
          if (!Number.isFinite(item.size) || item.size < 0) throw fault('远端文件大小无效：' + name);
          const record = { size: item.size, etag: etag(item.props?.getetag), ...(Number.isFinite(modified) ? {modified} : {}) }, old = state.remote[name];
          if (sameToken(record.etag,old?.etag) && record.size === old.size) {record.version = old.version;record.etag=old.etag;}
          files[name] = record;
        }
      }
    };
    await visit(root); return { files, skipped, entries };
  }
  refreshTree() { return this.start(async () => {
    await this.cleanupPlan();
    const context = await this.client();let first;
    try{first=await this.request(o=>context.client.getDirectoryContents(context.root,{...o,details:true}),context.settings);}catch(error){if(error.status!==404)throw error;}
    const remote = first ? await this.remote(context,{remote:{}},excludedBy(context.settings),new Set(),true,first) : {entries:[]};
    const tree = await saveTree(await this.stateFile(context.identity),context.root,remote.entries);
    this.progress({phase:'idle',current:''}); return tree;
  }, 'directory'); }
  async fetched(context, name, record, directory) {
    if (!record || record.file) return record || null;
    this.progress({ current: name });
    const target = path.join(directory, crypto.randomUUID() + '.tmp');
    const get = () => this.request(async o => {
      await fs.unlink(target).catch(() => {});
      return download(context.client, path.posix.join(context.root, name), name, target,
        { ...o, method: 'GET', headers: record.etag ? { 'If-Match': record.etag } : {} }, limit(context.settings), record.size);
    }, context.settings);
    let downloaded;
    try { downloaded = await get(); }
    catch (error) {
      error.file = name;
      if (error.status !== 412 || !record.etag) throw error;
      record.etag = await this.alternateTag(context,name,record.etag,error);
      downloaded = await get();
    }
    if (record.etag && downloaded.responseTag) {
      if (!sameToken(record.etag,downloaded.responseTag)) throw fault('下载时远端版本发生变化：'+name,'CONFLICT');
      record.etag = downloaded.responseTag;
    }
    if (this.plan) this.plan.transferBytes += downloaded.size;
    Object.assign(record, downloaded); return record;
  }
  async alternateTag(context,name,expected,error) {
    let response;
    try { response = await this.request(o=>context.client.customRequest(path.posix.join(context.root,name),{...o,method:'HEAD'}),context.settings); }
    catch { throw error; }
    const next = etag(response.headers.get('etag')); response.body?.destroy?.();
    if (!next || next === expected || !sameToken(expected,next)) throw error;
    return next;
  }
  async writeRequest(plan,name,remote,action,uploaded) {
    const perform = () => this.request(o=>action(o,remote ? {'If-Match':remote.etag} : {'If-None-Match':'*'}),plan.context.settings);
    try { return await perform(); }
    catch (error) {
      error.file=name;
      if (error.status === 412 && uploaded) {
        // A successful PUT can lose its acknowledgement, then fail its retry's
        // old precondition. Verify the current body before accepting convergence.
        const response=await this.request(o=>plan.context.client.customRequest(path.posix.join(plan.context.root,name),{...o,method:'HEAD'}),plan.context.settings);
        const tag=etag(response.headers.get('etag')),length=response.headers.get('content-length');response.body?.destroy?.();
        if(tag){const record=await this.fetched(plan.context,name,{etag:tag,...(length!==null&&/^\d+$/.test(length)?{size:Number(length)}:{})},plan.directory);if(record.version===uploaded.version)return {...record,version:uploaded.version};}
      }
      if (!remote || error.status !== 412) throw error;
      const next = await this.alternateTag(plan.context,name,remote.etag,error);
      const verified = await this.fetched(plan.context,name,{...remote,etag:next,file:undefined},plan.directory);
      if (verified.version !== remote.version) throw fault('远端文件已改变，请重新同步。\n'+name,'CONFLICT');
      remote.etag=verified.etag;
      return perform();
    }
  }
  async cleanupPlan() {
    if (this.plan?.directory) {
      // Delete only owned temporary names, leaving the visible sync directory intact.
      for (const entry of await fs.readdir(this.plan.directory)) if (/^[a-f\d-]+\.tmp$/i.test(entry)) await fs.unlink(path.join(this.plan.directory, entry)).catch(() => {});
    }
    this.plan = null;
  }
  start(action, operation = 'sync') {
    if (this.running) throw fault('已有同步任务正在执行。', 'BUSY');
    this.controller = new AbortController();
    this.cancelRequested = false;
    if(operation==='sync')this.lastStarted=Date.now();
    this.progress({ operation, phase: 'scan', current: '', completed: 0, total: 0, error: '', pending: undefined });
    this.running = (async () => {
      try { return await action(); }
      catch (e) {
        const error = this.explain(e);
        this.progress({ phase: error.code === 'CANCELLED' ? 'cancelled' : 'error', error: error.message, current: '' });
        await this.cleanupPlan(); throw error;
      } finally { this.running = null; this.controller = null; }
    })(); return this.running;
  }
  async cancel() {
    this.cancelRequested = true;
    this.controller?.abort();
    if (this.running) await this.running.catch(() => {});
    else { await this.cleanupPlan(); this.progress({ phase: 'cancelled', current: '', error: '', pending: undefined }); }
    return true;
  }
  async prepare(only) {
    const started = Date.now();
    await this.cleanupPlan();
    const context = await this.client(), { identity, settings, client, root } = context;
    const persistence = new SyncState(await this.stateFile(identity)), state = await persistence.read();
    if (persistence.pending) await persistence.compact(state);
    let first,exists=true;
    if(!only)try{first=await this.request(o=>client.getDirectoryContents(root,{...o,details:true}),settings);}catch(error){if(error.status!==404)throw error;exists=false;}
    if (!exists && (state.lastSync || Object.keys(state.base).length)) throw fault('远端同步目录不存在，请检查服务器或连接设置。');
    const directory = await internal(this.vault, 'sync/transfers');
    this.plan = { context, state, persistence, directory, exists };
    await this.cleanupPlan(); this.plan = { context, state, persistence, directory, exists, transferBytes:0 };
    const excluded = excludedBy(settings);
    let local,remote;
    if(only){
      if(!eligible(only)||excluded(only))throw fault('该文件不在同步范围内。');
      const record=await info(this.vault,only);if(record&&record.size>limit(settings))throw fault('本地文件超过大小限制：'+only);
      if(record)record.version=await digest(record.file,this.controller.signal);
      local={files:record?{[only]:record}:{},skipped:[]};
      const snapshot=await readTree(await this.stateFile(identity)),entries=new Map((snapshot?.entries||[]).map(entry=>[entry.path,entry]));let current;
      try{const result=await this.request(o=>client.stat(path.posix.join(root,only),{...o,details:true}),settings),item=result.data;
        if(item.type!=='file'||!Number.isFinite(item.size)||item.size<0||item.size>limit(settings))throw fault('远端文件类型或大小无效：'+only);
        const modified=Date.parse(item.lastmod);current={size:item.size,etag:etag(item.props?.getetag),...(Number.isFinite(modified)?{modified}:{})};
        const old=state.remote[only];if(sameToken(current.etag,old?.etag)&&current.size===old.size){current.version=old.version;current.etag=old.etag;}
        entries.set(only,{path:only,type:'file',size:current.size,...(current.modified?{modified:current.modified}:{})});
      }catch(error){if(error.status!==404)throw error;if(!await this.request(o=>client.exists(root,o),settings))throw fault('远端同步目录不存在，请检查服务器或连接设置。');entries.delete(only);}
      remote={files:current?{[only]:current}:{},skipped:[],entries:[...entries.values()]};
    }else local=await localFiles(this.vault, excluded, limit(settings), this.localCache, this.controller.signal);
    const blocked = new Set(local.skipped.map(x => x.path));
    remote ||= exists ? await this.remote(context, state, excluded, blocked,false,first) : { files: {}, skipped: [], entries: [] };
    if(!only)await saveTree(await this.stateFile(identity),root,remote.entries);
    for (const name of blocked) { delete local.files[name]; delete remote.files[name]; }
    const names = only?[only]:[...new Set([...Object.keys(state.base), ...Object.keys(local.files), ...Object.keys(remote.files)])].sort();
    if(process.platform==='win32'){
      const seen=new Map();for(const name of names){const key=name.toLowerCase(),previous=seen.get(key);if(previous&&previous!==name)throw fault('文件名在 Windows 上冲突，请在远端处理后重试：'+previous+' / '+name,'CONFLICT');seen.set(key,name);}
    }
    this.progress({ total: names.length });
    let index = 0;
    // The bounded pool fetches only changed remote revisions; bodies stay on disk.
    const workers = Array.from({ length: settings.concurrency }, async () => {
      while (index < names.length) { const name = names[index++];
        if (remote.files[name] && !remote.files[name].version) {
          try { await this.fetched(context, name, remote.files[name], directory); }
          catch (error) { this.controller.abort(error); throw error; }
        }
      }
    });
    const settled = await Promise.allSettled(workers), failure = settled.find(r => r.status === 'rejected');
    if (failure) throw failure.reason;
    const operations = [], skipped = [...new Map([...local.skipped, ...remote.skipped].map(x => [x.path, x])).values()];
    for (const name of names) {
      if (excluded(name) || blocked.has(name)) continue;
      const l = local.files[name], r = remote.files[name], before = state.base[name] || null;
      const lv = l?.version || null, rv = r?.version || null;
      const direction = lv === rv ? 'same' : lv === before ? 'download' : rv === before ? 'upload' : 'conflict';
      const deletion = direction === 'upload' && !l || direction === 'download' && !r;
      if (deletion && settings.deletion === 'keep') { skipped.push({ path: name, reason: '未同步删除' }); continue; }
      operations.push({ path: name, direction, deletion, local: lv, remote: rv });
    }
    const plan = Object.assign(this.plan, { token: crypto.randomUUID(), created: Date.now(), scanDuration:Date.now()-started, tree: new Map(remote.entries.map(item=>[item.path,item])), local: local.files, remote: remote.files, operations, skipped });
    this.progress({ phase: 'ready', current: '', completed: 0, total: operations.filter(x => x.direction !== 'same').length });
    return plan;
  }
  summary(plan) {
    const changes = plan.operations.filter(x => x.direction !== 'same');
    return { token: plan.token, firstSync: !plan.state.lastSync, changes: changes.map(x => ({ path: x.path,
      action: x.direction === 'conflict' ? '冲突' : x.deletion ? x.direction === 'upload' ? '删除远端' : '删除本地' : x.direction === 'upload' ? '上传' : '下载' })),
      deletions: changes.filter(x => x.deletion).map(x => ({ path: x.path, side: x.direction === 'upload' ? 'remote' : 'local' })), skipped: plan.skipped };
  }
  preview() { return this.start(async () => this.summary(await this.prepare())); }
  sync(input = {}) { return this.start(() => this.run(input)); }
  resolve(input) {
    if (!['local', 'remote', 'both'].includes(input.choice)) throw fault('冲突处理方式无效。');
    return this.start(() => this.run({ resolution: input }));
  }
  async commit(plan, name, local, remote, version) {
    if (version) plan.state.base[name] = version; else delete plan.state.base[name];
    await plan.persistence.record(plan.state, name, version, { local: localMeta(local), remote: remoteMeta(remote) });
    if (local) this.localCache[name] = localMeta(local); else delete this.localCache[name];
    if (remote) plan.tree.set(name,{path:name,type:'file',size:remote.size,...(remote.modified ? {modified:remote.modified} : {}),...(plan.tree.get(name)?.created ? {created:plan.tree.get(name).created} : {})}); else plan.tree.delete(name);
  }
  invalidateLocal(name) {
    if(!name){this.localCache={};return;}
    for(const key of Object.keys(this.localCache))if(key===name||key.startsWith(name+'/'))delete this.localCache[key];
  }
  async hasLocalChanges(paths) {
    const {identity,settings}=await this.client(),state=await this.state(identity),excluded=excludedBy(settings);
    const local=await localFiles(this.vault,excluded,limit(settings),this.localCache),blocked=new Set(local.skipped.map(item=>item.path));
    const selected=name=>!paths?.size||paths.has('*')||[...paths].some(prefix=>name===prefix||name.startsWith(prefix+'/'));
    return [...new Set([...Object.keys(state.base),...Object.keys(local.files)])].some(name=>selected(name)&&!excluded(name)&&!blocked.has(name)&&(local.files[name]?.version||null)!==(state.base[name]||null));
  }
  async upload(plan, name, local, remote) {
    const { context, directory } = plan, { client, root, settings } = context;
    if (remote && !remote.etag) throw fault('服务器未提供 ETag，不能安全覆盖或删除远端文件：' + name);
    const current = await info(this.vault, name);
    const buffer = current && current.size <= 2 * 1024 * 1024 ? await fs.readFile(current.file) : null;
    const version = current ? buffer ? hash(buffer) : await digest(current.file, this.controller.signal) : null;
    if (version !== (local?.version || null)) throw fault('本地文件发生变化，请重新同步：' + name, 'CONFLICT');
    const target = path.posix.join(root, name);
    let next = null;
    if (!local) await this.writeRequest(plan,name,remote,(o,headers)=>client.deleteFile(target,{...o,headers}));
    else {
      await this.ensureDirectory(client, path.posix.dirname(target), plan.directories, settings);
      // Upload a validated, stable revision. Retries never stream the changing source.
      const stage = buffer ? null : path.join(directory, crypto.randomUUID() + '.tmp');
      if (stage) {
        await fs.copyFile(current.file, stage);
        if (await digest(stage, this.controller.signal) !== local.version) throw fault('本地文件发生变化，请重新同步：' + name, 'CONFLICT');
      }
      try {
        next = await this.writeRequest(plan,name,remote,async (o,headers) => {
          const stream = stage ? native.createReadStream(stage, { signal: o.signal }) : null;
          stream?.on('error', () => {});
          try {
            const response = await client.customRequest(target, { ...o, method: 'PUT', data: stream || buffer,
              headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(local.size) } });
            const modified = Date.parse(response.headers.get('last-modified'));
            const result = { etag: etag(response.headers.get('etag')), size: local.size, version: local.version, ...(Number.isFinite(modified) ? {modified} : {}) };
            response.body?.destroy?.();
            return result;
          } finally { stream?.destroy(); }
        },local);
        plan.transferBytes += local.size;
      } finally { if (stage) await fs.unlink(stage).catch(() => {}); }
    }
    // Use only the PUT response's validator. A later stat could describe another
    // writer's bytes; servers without PUT validators are verified on the next scan.
    await this.commit(plan, name, local, next, local?.version || null);
  }
  async conflict(plan, operation, allowText = true) {
    const name = operation.path, local = plan.local[name], remote = plan.remote[name];
    const previous=plan.state.conflicts?.find(item=>item.path===name&&item.local===operation.local&&item.remote===operation.remote);
    if(previous&&(!remote||remote.version))return previous;
    let localText = null, remoteText = null;
    if (remote) {
      await this.fetched(plan.context, name, remote, plan.directory);
      await conflictCopy(this.vault, name, remote);
    }
    if (allowText && /\.(md|markdown|txt|js|ts|py|c|cpp|h|hpp|sql|lua|json|css)$/i.test(name)) {
      const head = async file => { const f = await fs.open(file, 'r'); try { const buffer = Buffer.alloc(8192); const { bytesRead } = await f.read(buffer, 0, buffer.length, 0); return buffer.subarray(0, bytesRead).toString('utf8'); } finally { await f.close(); } };
      if (local) localText = await head(local.file);
      if (remote) remoteText = await head(remote.file);
    }
    return { path: name, local: operation.local, remote: operation.remote, localText, remoteText,
      truncated: !!localText && local.size > 8192 || !!remoteText && remote.size > 8192 };
  }
  async keepBoth(plan, operation) {
    const name = operation.path, remote = plan.remote[name];
    if (!operation.local || !remote) throw fault('删除冲突不能保留两份。');
    await this.fetched(plan.context, name, remote, plan.directory);
    const extension = path.posix.extname(name), stem = name.slice(0, -extension.length || undefined);
    let copy;
    for (let i = 1;; i++) { copy = stem + '-远端-' + i + extension; if (!await info(this.vault, copy) && !plan.remote[copy]) break; }
    const file = path.join(plan.directory, crypto.randomUUID() + '.tmp');
    await fs.copyFile(remote.file, file);
    const local = await apply(this.vault, copy, { ...remote, file }, null, this.controller.signal);
    await this.upload(plan, copy, local, null); await this.upload(plan, name, plan.local[name], remote);
    return copy;
  }
  async run(input) {
    const started = Date.now();
    const current = await this.client();
    const cached = input.token && this.plan?.token === input.token && this.plan.context.identity === current.identity
      && this.plan.context.configuration === current.configuration
      && Date.now() - this.plan.created < 120000;
    const plan = cached ? this.plan : await this.prepare(input.resolution?.path);
    const summary = this.summary(plan);
    const deletionApproval = !input.resolution && current.settings.deletion === 'confirm' && summary.deletions.length && input.token !== plan.token;
    if (deletionApproval || input.automatic && !plan.state.lastSync || input.token && input.token !== plan.token) {
      this.progress({ phase: 'awaiting', pending: summary, current: '' });
      return { ...summary, needsConfirmation: true, lastSync: plan.state.lastSync, conflicts: plan.state.conflicts || [] };
    }
    this.progress({ phase: 'transfer', completed: 0, total: input.resolution ? 1 : summary.changes.length });
    plan.directories = new Set(plan.exists?[plan.context.root,...[...plan.tree.values()].filter(entry=>entry.type==='folder').map(entry=>path.posix.join(plan.context.root,entry.path))]:[]);
    if (!plan.exists) await this.ensureDirectory(plan.context.client, plan.context.root, plan.directories, current.settings);
    const conflicts = input.resolution ? (plan.state.conflicts || []).filter(c => c.path !== input.resolution.path) : [], changes = [];
    const cachedBefore = JSON.stringify({ local: plan.state.local, remote: plan.state.remote, conflicts: plan.state.conflicts });
    if (input.resolution && !plan.operations.some(o => o.path === input.resolution.path)) throw fault('冲突已改变，请重新同步。', 'CONFLICT');
    for (const operation of plan.operations) {
      if (input.resolution && operation.path !== input.resolution.path) continue;
      this.controller.signal.throwIfAborted();
      const name = operation.path; let direction = operation.direction;
      if (input.resolution?.path === name) {
        if (input.resolution.local !== operation.local || input.resolution.remote !== operation.remote) throw fault('冲突版本已改变，请重新同步后再选择。', 'CONFLICT');
        direction = input.resolution.choice === 'local' ? 'upload' : input.resolution.choice === 'remote' ? 'download' : 'both';
      }
      this.progress({ current: name });
      if (direction === 'conflict') {conflicts.push(await this.conflict(plan, operation, conflicts.length < 32));if(plan.remote[name])plan.state.remote[name]=remoteMeta(plan.remote[name]);if(plan.local[name])plan.state.local[name]=localMeta(plan.local[name]);}
      else if (direction === 'same') {
        if (operation.local !== (plan.state.base[name] || null)) await this.commit(plan, name, plan.local[name], plan.remote[name], operation.local);
        else { if (plan.local[name]) plan.state.local[name] = localMeta(plan.local[name]); if (plan.remote[name]) plan.state.remote[name] = remoteMeta(plan.remote[name]); }
      } else if (direction === 'both') changes.push({ path: name, action: '保留两份', size:(plan.local[name]?.size || 0)+(plan.remote[name]?.size || 0), copy: await this.keepBoth(plan, operation) });
      else if (direction === 'upload') {
        await this.upload(plan, name, plan.local[name], plan.remote[name]); changes.push({ path: name, action: plan.local[name] ? '上传' : '删除远端', size:plan.local[name]?.size });
      } else {
        if (!plan.remote[name] && await this.request(o => plan.context.client.exists(path.posix.join(plan.context.root, name), o), current.settings)) {
          throw fault('远端文件已重新出现，请重新同步：' + name, 'CONFLICT');
        }
        const remote = await this.fetched(plan.context, name, plan.remote[name], plan.directory);
        const local = await apply(this.vault, name, remote, operation.local, this.controller.signal);
        await this.commit(plan, name, local, remote, operation.remote); changes.push({ path: name, action: remote ? '下载' : '删除本地', size:remote?.size });
      }
      if (direction !== 'same') this.progress({ completed: this.job.completed + 1 });
    }
    plan.state.conflicts = conflicts; plan.state.lastSync = Date.now();
    plan.state.report = { changes: changes.slice(-200), skipped: plan.skipped.slice(0, 200), totalChanges: changes.length, totalSkipped: plan.skipped.length,
      duration:Date.now()-started+(cached ? plan.scanDuration : 0), bytes:plan.transferBytes, conflicts:conflicts.length,
      counts:Object.fromEntries(['上传','下载','删除本地','删除远端','保留两份'].map(action=>[action,changes.filter(c=>c.action===action).length])) };
    // Refresh only directly affected parents. Resolving one conflict must never
    // recurse through unrelated folders or fetch other conflicting bodies.
    const parents=new Set(changes.filter(c=>['上传','删除远端','保留两份'].includes(c.action)).map(c=>path.posix.dirname(c.path)));
    for(const parent of parents){
      const listing=await this.request(o=>plan.context.client.getDirectoryContents(path.posix.join(plan.context.root,parent),{...o,details:true}),current.settings),present=new Set();
      for(const item of listing.data){if(!item.basename||/[\/\\\x00-\x1f]/.test(item.basename)||['.','..'].includes(item.basename))throw fault('远端返回了无效文件名。');
        const name=parent==='.'?item.basename:parent+'/'+item.basename;present.add(name);const modified=Date.parse(item.lastmod),created=Date.parse(item.props?.creationdate);
        plan.tree.set(name,{path:name,type:item.type==='directory'?'folder':'file',size:Number.isFinite(item.size)?item.size:0,...(Number.isFinite(modified)?{modified}:{}),...(Number.isFinite(created)?{created}:{}),...(excludedBy(current.settings)(name)?{excluded:'已排除'}:{})});
      }
      for(const name of plan.tree.keys())if(path.posix.dirname(name)===parent&&!present.has(name))for(const child of plan.tree.keys())if(child===name||child.startsWith(name+'/'))plan.tree.delete(child);
    }
    if(parents.size||input.resolution)await saveTree(await this.stateFile(plan.context.identity),plan.context.root,[...plan.tree.values()],input.resolution?{preserveScan:true}:{});
    const cachedAfter = JSON.stringify({ local: plan.state.local, remote: plan.state.remote, conflicts });
    if (plan.persistence.pending || cachedAfter !== cachedBefore || !plan.state.revision) await plan.persistence.compact(plan.state);
    // An unchanged run updates a small timestamp/report, not the full baseline.
    await plan.persistence.summary(plan.state);
    const result = { lastSync: plan.state.lastSync, conflicts, changes, skipped: plan.skipped };
    await this.cleanupPlan(); this.progress({ phase: 'idle', current: '', pending: undefined }); return result;
  }
}
module.exports = { WebDAVSync };
