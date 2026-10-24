import semver from 'semver';
export const stableReleaseVersion=tag=>{const value=semver.valid(String(tag||'').replace(/^v/,''));return value&&[value,'v'+value].includes(tag)&&!semver.prerelease(value)?value:null;};
export const newerRelease=(version,current)=>!!semver.valid(version)&&!!semver.valid(current)&&semver.gt(version,current);
export const repository = 'JJl624/Moyu';
export const releases = 'https://github.com/' + repository + '/releases';
export function releaseAssets(version, platform=typeof process==='object'?process.platform:'android', arch=typeof process==='object'?process.arch:'universal') {
  const prefix=`Moyu-${version}-${arch}`;
  if(platform==='android')return['Moyu-Android-'+version+'.apk'];
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
export const missingAsset = platform => `新版本的 ${{win32:'Windows',linux:'Linux',darwin:'macOS',android:'Android'}[platform]||platform} 下载文件尚未就绪。`;
export function releaseInfo(value, platform=typeof process==='object'?process.platform:'android', arch=typeof process==='object'?process.arch:'universal', currentVersion) {
  const version = semver.valid(String(value?.tag_name || '').replace(/^v/, ''));
  if (!version || ![version,'v'+version].includes(value.tag_name) || semver.prerelease(version) || value.draft || value.prerelease) throw Error('未找到正式发布的版本。');
  const info={version,url:`${releases}/tag/${encodeURIComponent(value.tag_name)}`};
  if(currentVersion&&semver.lte(version,currentVersion))return info;
  const ready = releaseAssets(version,platform,arch).some(name => Array.isArray(value.assets) && value.assets.some(a =>
    a.name===name && a.state==='uploaded' && Number.isSafeInteger(a.size) && a.size>0
    && a.browser_download_url===`${releases}/download/${encodeURIComponent(value.tag_name)}/${name}`));
  if (!ready) throw Error(missingAsset(platform));
  if(platform==='android')info.downloadUrl=`${releases}/download/${encodeURIComponent(value.tag_name)}/${releaseAssets(version,platform,arch)[0]}`;
  return info;
}
