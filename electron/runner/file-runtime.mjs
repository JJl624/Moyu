import { nameOf, decode, encode } from './run-files.mjs';
const isDirectory = mode => (mode & 0o170000) === 0o040000;
const isLink = mode => (mode & 0o170000) === 0o120000;
function mkdirParents(FS, directory) {
  let target = '';
  for (const part of directory.split('/').filter(Boolean)) {
    target += '/' + part;
    let stat;
    try { stat = FS.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stat) FS.mkdir(target);
    else if (!isDirectory(stat.mode)) throw new Error('数据目录路径不是文件夹。');
  }
}
export function mountData(FS, files) {
  const clear = directory => {
    for (const name of FS.readdir(directory).filter(name => name !== '.' && name !== '..')) {
      const target = directory + '/' + name, stat = FS.lstat(target);
      if (isDirectory(stat.mode)) { clear(target); FS.rmdir(target); } else FS.unlink(target);
    }
  };
  FS.chdir('/'); mkdirParents(FS, '/data'); clear('/data'); mkdirParents(FS, '/data/output');
  for (const file of files || []) {
    const name = nameOf(file.name); mkdirParents(FS, '/data/' + name.split('/').slice(0, -1).join('/')); FS.writeFile('/data/' + name, decode(file.data));
  }
  FS.chdir('/data');
}
export function collectData(FS) {
  const result = []; let bytes = 0;
  const visit = (directory, prefix = '', depth = 0) => {
    if (depth > 12) throw new Error('数据目录层级过深。');
    for (const name of FS.readdir(directory).filter(name => name !== '.' && name !== '..')) {
      const target = directory + '/' + name, stat = FS.lstat(target), logical = nameOf(prefix + name);
      if (isLink(stat.mode)) throw new Error('代码数据不支持符号链接。');
      if (isDirectory(stat.mode)) visit(target, logical + '/', depth + 1);
      else if (FS.isFile(stat.mode)) {
        if (stat.size > 20 * 1024 * 1024 || (bytes += stat.size) > 40 * 1024 * 1024 || result.length >= 128) throw new Error('代码数据超过限制。');
        result.push({ name: logical, data: encode(FS.readFile(target)) });
      }
    }
  };
  visit('/data'); return result;
}
export const fileArtifacts = files => files.filter(file => file.name.startsWith('output/')).slice(0, 20).map(file => {
  const mime = file.name.endsWith('.svg') ? 'image/svg+xml' : file.name.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  return { kind: mime.startsWith('image/') ? 'image' : 'file', name: file.name.slice(7), data: file.data, mime };
});
