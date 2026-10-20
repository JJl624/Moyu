const fs = require('node:fs');
const path = require('node:path');

// build-native stages the complete runtime, including the external esbuild
// API. This supported hook stops builder from scanning the development tree.
module.exports = async ({ appDir }) => {
  for (const name of ['electron/main.cjs', 'node_modules/esbuild/package.json', 'node_modules/esbuild/lib/main.js', 'resources/tools/'+require('../shared/native-esbuild.cjs').esbuildName()]) {
    if (!fs.statSync(path.join(appDir, name), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing staged runtime file: ${name}`);
    }
  }
  return false;
};
