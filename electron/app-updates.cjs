const semver = require('semver');
const { ApplicationConfig } = require('./application-config.cjs');
const { readDownload } = require('./download-tasks.cjs');
const repository = 'JJl624/Moyu';
const releases = 'https://github.com/' + repository + '/releases';
const DAY = 24 * 60 * 60 * 1000;
const updateError = message => Object.assign(Error(message), {code:'UPDATE_RELEASE'});
function releaseAssets(version, platform=process.platform, arch=process.arch) {
  const prefix=`Moyu-${version}-${arch}`;
  if(platform==='win32')return[prefix+'.exe'];
  if(platform==='linux'){
    // electron-builder uses the distribution's architecture names in each
    // target's filename, rather than Node's x64/ia32 names.
    const imageArch=arch==='x64'?'x86_64':arch==='ia32'?'i386':arch;
    const debArch=arch==='x64'?'amd64':arch==='ia32'?'i386':arch;
    return[`Moyu-${version}-${imageArch}.AppImage`,`Moyu-${version}-${debArch}.deb`];
  }
  if(platform==='darwin')return[prefix+'.dmg',prefix+'.zip'];
  throw Error('此平台暂无更新包。');
}
const missingAsset = platform => `新版本的 ${{win32:'Windows',linux:'Linux',darwin:'macOS'}[platform]||platform} 下载文件尚未就绪。`;
function releaseInfo(value, platform=process.platform, arch=process.arch, currentVersion) {
  const version = semver.valid(String(value?.tag_name || '').replace(/^v/, ''));
  if (!version || ![version,'v'+version].includes(value.tag_name) || semver.prerelease(version) || value.draft || value.prerelease) throw Error('未找到正式发布的版本。');
  const info={version,url:`${releases}/tag/${encodeURIComponent(value.tag_name)}`};
  if(currentVersion&&semver.lte(version,currentVersion))return info;
  const ready = releaseAssets(version,platform,arch).some(name => Array.isArray(value.assets) && value.assets.some(a =>
    a.name===name && a.state==='uploaded' && Number.isSafeInteger(a.size) && a.size>0
    && a.browser_download_url===`${releases}/download/${encodeURIComponent(value.tag_name)}/${name}`));
  if (!ready) throw Error(missingAsset(platform));
  return info;
}
class AppUpdates {
  constructor(root, version, { fetch: request = (...args) => globalThis.fetch(...args), now = Date.now, automatic = true, platform=process.platform, arch=process.arch } = {}) {
    this.store = new ApplicationConfig(root); this.version = version; this.request = request;
    this.now = now; this.canAutoCheck = automatic; this.pending = null;
    this.platform=platform;this.arch=arch;
  }
  async state() {
    const saved = await this.store.get('updates');
    const latest = saved.latest && semver.valid(saved.latest.version) && semver.gt(saved.latest.version, this.version)
      && [saved.latest.version, 'v'+saved.latest.version].some(tag => saved.latest.url === `${releases}/tag/${encodeURIComponent(tag)}`)
      ? saved.latest : null;
    return { current: this.version, automatic: saved.automatic !== false, canAutoCheck: this.canAutoCheck,
      checkedAt: saved.checkedAt || 0, attemptedAt: saved.attemptedAt || 0, latest };
  }
  async configure(automatic) {
    if (typeof automatic !== 'boolean') throw Error('更新设置无效。');
    await this.store.update('updates', saved => ({ ...saved, automatic }));
    return this.state();
  }
  async fallback() {
    // Public API limits are shared by network address. GitHub's own latest
    // redirect also identifies a stable release without an account or token.
    const response = await this.request(releases+'/latest', { redirect:'manual', signal:AbortSignal.timeout(10000) });
    await response.body?.cancel();
    if (response.status === 403 || response.status === 429) throw updateError('GitHub 请求受限，请稍后重试。');
    if (response.status === 404) throw updateError('暂时没有可下载的正式版本。');
    const target = new URL(response.headers.get('location') || '', releases+'/latest');
    const prefix = `/${repository}/releases/tag/`, tag = decodeURIComponent(target.pathname.slice(prefix.length));
    const version = semver.valid(tag.replace(/^v/,''));
    if (![301,302,303,307,308].includes(response.status) || target.origin !== 'https://github.com'
      || !target.pathname.startsWith(prefix) || !version || ![version,'v'+version].includes(tag) || semver.prerelease(version)
      || target.search || target.hash) throw updateError('无法读取 GitHub 版本信息，请稍后重试。');
    if(semver.lte(version,this.version))return {version,url:`${releases}/tag/${encodeURIComponent(tag)}`};
    for(const name of releaseAssets(version,this.platform,this.arch)){
      const download = await this.request(`${releases}/download/${encodeURIComponent(tag)}/${name}`, {
        method:'HEAD', signal:AbortSignal.timeout(10000),
      });
      await download.body?.cancel();
      if(download.ok && Number(download.headers.get('content-length'))>0)return {version,url:`${releases}/tag/${encodeURIComponent(tag)}`};
    }
    throw updateError(missingAsset(this.platform));
  }
  async check(manual = false) {
    if (this.pending) return this.pending;
    const saved = await this.state(), elapsed = this.now() - Math.max(saved.checkedAt,saved.attemptedAt);
    if (!manual && (!saved.automatic || !this.canAutoCheck || (elapsed >= 0 && elapsed < DAY))) return saved;
    // Coalesce simultaneous clicks. Failures never turn into a "latest" result
    // or advance the last successful check time.
    if (this.pending) return this.pending;
    const task = (async () => {
      if (!manual) await this.store.update('updates', data => ({...data,attemptedAt:this.now()}));
      let response;
      try {
        response = await this.request(`https://api.github.com/repos/${repository}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* Retry through GitHub's release redirect below. */ }
      let latest;
      if (!response || [403,429].includes(response.status)) {
        await response?.body?.cancel();
        try { latest = await this.fallback(); }
        catch (error) { throw error.code === 'UPDATE_RELEASE' ? error : Error('无法连接 GitHub，请稍后重试。'); }
      } else if (!response.ok) {
        await response.body?.cancel();
        throw Error(response.status === 404 ? '暂时没有可下载的正式版本。' : response.status === 403 || response.status === 429
          ? 'GitHub 请求受限，请稍后重试。' : '检查更新失败（HTTP ' + response.status + '）。');
      } else {
        let metadata;
        try { metadata = JSON.parse((await readDownload(response, 256 * 1024)).toString('utf8')); }
        catch { throw Error('无法读取 GitHub 版本信息，请稍后重试。'); }
        latest = releaseInfo(metadata,this.platform,this.arch,this.version);
      }
      await this.store.update('updates', data => ({ ...data, checkedAt: this.now(), latest }));
      return this.state();
    })();
    this.pending = task;
    try { return await task; } finally { if (this.pending === task) this.pending = null; }
  }
}
module.exports = { AppUpdates, releaseInfo, releaseAssets };
