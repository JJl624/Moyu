const path = require('node:path');
const esbuildName = (platform = process.platform) => platform === 'win32' ? 'esbuild.exe' : 'esbuild';
const esbuildSource = (platform = process.platform, arch = process.arch) =>
  path.join('@esbuild', `${platform}-${arch}`, platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild');
module.exports = { esbuildName, esbuildSource };
