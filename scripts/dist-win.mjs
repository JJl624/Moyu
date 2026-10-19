import { Arch, build, Platform } from 'electron-builder';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// Initialize electron-builder first; its CJS target modules have import cycles.
const {default:nsis}=await import('app-builder-lib/out/targets/nsis/NsisTarget.js');

// Build adapter for the pinned electron-builder target. This version has no
// portable script override. Installed dependencies and other targets stay intact.
const root = path.resolve(import.meta.dirname, '..');
const builder = JSON.parse(
  await fs.readFile(path.join(root, 'node_modules/app-builder-lib/package.json'), 'utf8'),
);
if (builder.version !== '26.15.3') {
  throw Error('Revalidate the Moyu portable build adapter before upgrading electron-builder.');
}
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const prepackaged = process.argv.includes('--prepackaged')
  ? path.join(root, pkg.build.directories.output, 'win-unpacked')
  : undefined;
const source = await fs.readFile(path.join(root, 'scripts/portable.nsi'), 'utf8');
const previous = nsis.NsisTarget.prototype.computeFinalScript;
nsis.NsisTarget.prototype.computeFinalScript = async function(raw, ...args) {
  if (this.isPortable) {
    if (!this.options.useZip) throw Error('Moyu portable launcher requires ZIP compression.');
    // Cache identity follows application content and the runtime executable,
    // including same-version rebuilds. Both are streamed, never held in memory.
    const digest = createHash('sha256');
    for (const directory of this.archs.values()) {
      for (const name of ['resources/app.asar', this.packager.appInfo.productFilename + '.exe']) {
        for await (const chunk of createReadStream(path.join(directory, name))) {
          digest.update(chunk);
        }
      }
    }
    raw = source.replaceAll('@BUILD_ID@', digest.digest('hex').slice(0, 16));
  }
  return previous.call(this, raw, ...args);
};
await build({
  projectDir: root,
  ...(prepackaged ? { prepackaged } : {}),
  targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64),
});
