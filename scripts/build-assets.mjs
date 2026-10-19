import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { responseBytes, unpack } = require('../electron/npm-store.cjs');
const project = path.resolve(import.meta.dirname, '..');
const folder = 'resources/bundled-runtimes';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Package the pinned compiler/runtime inputs separately from Git source.
// USTAR has no links, devices, extended paths or executable hooks.
export async function packBuildAssets(root, file) {
  async function* archive(directory, prefix) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name,'en'))) {
      const source = path.join(directory, entry.name), name = prefix + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error('Build assets cannot contain symlinks');
      if (entry.isDirectory()) { yield* archive(source, name); continue; }
      if (!entry.isFile()) throw Error('Invalid build asset');
      const size = (await fs.stat(source)).size, header = Buffer.alloc(512);
      const split = name.length > 100 ? name.lastIndexOf('/') : -1;
      const basename = split < 0 ? name : name.slice(split + 1), parent = split < 0 ? '' : name.slice(0, split);
      if (Buffer.byteLength(basename) > 100 || Buffer.byteLength(parent) > 155) throw Error('Build asset path too long');
      const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';
      header.write(basename, 0, 100); header.write(octal(0o644,8),100); header.write(octal(0,8),108);
      header.write(octal(0,8),116); header.write(octal(size,12),124); header.write(octal(0,12),136);
      header.fill(32,148,156); header.write('0',156); header.write('ustar\0',257); header.write('00',263);
      header.write(parent,345,155);
      header.write(header.reduce((sum,n) => sum+n,0).toString(8).padStart(6,'0')+'\0 ',148);
      yield header;
      for await (const chunk of createReadStream(source)) yield chunk;
      if (size % 512) yield Buffer.alloc(512 - size % 512);
    }
  }
  async function* contents() { yield* archive(path.join(root,folder), 'package/'+folder); yield Buffer.alloc(1024); }
  await pipeline(Readable.from(contents()),createGzip({level:9}),createWriteStream(file));
  const bytes = await fs.readFile(file);
  return { bytes: bytes.length, sha256: hash(bytes) };
}

export async function restoreBuildAssets(root, receipt, localFile) {
  // Installed inputs are checked again by prepare-bundled-runtimes before use.
  try {
    const index = JSON.parse(await fs.readFile(path.join(root,folder,'index.json'),'utf8'));
    if (index.version !== 1 || index.runtimes.length !== 7) throw Error('Incomplete build assets');
    for (const runtime of index.runtimes) for (const [name, info] of Object.entries(runtime.files)) {
      if ((await fs.stat(path.join(root,folder,runtime.kind,runtime.version,name))).size !== info.bytes) throw Error('Incomplete build assets');
    }
    return;
  } catch { /* A fresh checkout restores the pinned Release inputs below. */ }
  const bytes = localFile ? await fs.readFile(localFile) : await responseBytes(receipt.url,receipt.bytes);
  if (bytes.length !== receipt.bytes || hash(bytes) !== receipt.sha256) throw Error('Build assets checksum mismatch');
  const cache = path.join(root,'.runtime-build'); await fs.mkdir(cache,{recursive:true});
  const stage = path.join(cache,'build-assets-'+randomUUID()); await fs.mkdir(stage);
  try {
    await unpack(bytes,stage);
    const source = path.join(stage,folder);
    if (!(await fs.stat(path.join(source,'index.json'))).isFile()) throw Error('Build assets index missing');
    await fs.mkdir(path.join(root,'resources'),{recursive:true});
    await fs.cp(source,path.join(root,folder),{recursive:true});
  } finally { await fs.rm(stage,{recursive:true,force:true}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === 'pack') console.log(JSON.stringify(await packBuildAssets(project,path.resolve(process.argv[3]))));
  else if (process.argv[2] === 'restore') {
    const receipt = JSON.parse(await fs.readFile(path.join(project,'resources/build-assets.json'),'utf8'));
    await restoreBuildAssets(project,receipt,process.env.MOYU_BUILD_ASSETS_FILE);
  } else throw Error('Usage: node scripts/build-assets.mjs pack <file> | restore');
}
