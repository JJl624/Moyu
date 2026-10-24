import { createToolchain, compilerDiagnostics, CLANG_DRIVER_DEFAULT_ARGS } from '@live-codes/clang-wasm/toolchain';
import { nameOf, decode, encode } from './run-files.mjs';
import { clangProject } from './clang-project.mjs';
import { releaseCompletedCompilerMemory } from './clang-lifetime.mjs';
import { compilerWorkspace } from './clang-workspace.mjs';

// The compiler expects an HTTP asset origin. Only this reserved origin is
// remapped to the sandbox's packaged resources; no network server is involved.
const assetOrigin = 'https://clang.moyu.invalid';
const localFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  if (url.origin !== assetOrigin || !/^\/clang\/(runtime-manifest\.v1\.json|bin\/(clang|lld|memfs)\.wasm\.gz|bin\/sysroot\.tar\.gz)$/.test(url.pathname)) {
    return Promise.reject(new Error('运行环境禁止访问外部资源。'));
  }
  const response = await localFetch('moyu-run://sandbox' + url.pathname, options);
  // The package verifies that redirects did not change the requested asset.
  // This is a local transport adapter, so retain its logical reserved URL.
  Object.defineProperty(response, 'url', { value: url.href });
  return response;
};
let toolchain, artifact, signature = '', workspace, project, standards;
async function createEnvironment() {
  toolchain = await createToolchain({ baseUrl: assetOrigin + '/clang/' });
  releaseCompletedCompilerMemory(toolchain.runtime);
  workspace=compilerWorkspace(toolchain.runtime);
  const compile = toolchain.runtime.compile;
  // compileArtifact handles mixed translation units but shares compileArgs.
  // Apply the selected standard for each actual unit, rather than passing a
  // C++ -std flag to an auxiliary C file (or accepting the core's C11 fallback).
  toolchain.runtime.compile = options => compile.call(toolchain.runtime, {
    ...options, compileArgs: [...(options.compileArgs || []), '-std=' + (options.language === 'C' ? standards.cStandard : standards.cppStandard)],
  });
}
const send = value => self.postMessage(value);
self.onmessage = async event => {
  const input = event.data;
  let output = '', host, started = 0;
  try {
    if (input.type === 'init') {
      await createEnvironment();
      send({ type: 'ready' });
      return;
    }
    if (input.type === 'packages') {
      const language = input.language === 'c' ? 'C' : 'CPP';
      standards = input.clangSettings;
      project = clangProject(input);
      const dependencies = await Promise.all(project.workspaceFiles.map(async file => [file.path, Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content))).map(byte => byte.toString(16).padStart(2, '0')).join('')]));
      const next = JSON.stringify([language, project.code, standards.cStandard, standards.cppStandard, standards.optimizationLevel, dependencies]);
      if (next !== signature) {
        artifact = null;
        workspace.clear();
        const compiled = await toolchain.lock(() => toolchain.captureCompilerOutput(() => {
          // compileArtifact accepts UTF-8 text only; mount #embed bytes directly.
          for (const file of project.workspaceFiles) if (typeof file.content !== 'string') toolchain.addFile(file.path, file.content);
          return toolchain.runtime.compileArtifact(project.code, {
            language,
            fileName: project.entry,
            workspaceFiles: project.workspaceFiles.filter(file => typeof file.content === 'string'),
            // Include both standards in the core's own build cache key too.
            cVersion: standards.cStandard, cppVersion: standards.cppStandard,
            compileArgs: [...CLANG_DRIVER_DEFAULT_ARGS, ...(standards.optimizationLevel && standards.optimizationLevel!=='default'?['-'+standards.optimizationLevel]:[]), '-Iworkspace'],
          });
        })
        );
        if (compiled.error) throw new Error(compilerDiagnostics(compiled.raw).join('\n') || compiled.error.message);
        artifact = compiled.result;
        workspace.clear();
        signature = next;
      }
      // Only stdin is needed by execution; the next request rebuilds inputs.
      project={stdin:project.stdin};
      send({ type: 'packages' });
      return;
    }
    if (input.type !== 'run' || !artifact) return;
    const write = chunk => {
      if (output.length + chunk.length > 65536) {
        output += chunk.slice(0, Math.max(0, 65536 - output.length));
        throw new Error('输出超过 64 KB，已停止。');
      }
      output += chunk;
    };
    started = performance.now();
    let stdin = project.stdin;
    const result = await toolchain.execute(artifact, {
      files: (input.files || []).map(file => ({ path: nameOf(file.name), contents: decode(file.data) })),
      args: standards.arguments || [],
      stdin: () => { const next = stdin || null; stdin = undefined; return next; },
      stdout: write,
      stderr: write,
      extraImports: ({ host: current }) => {
        host = current;
        if (!host.rootDirectory.contents.has('output')) host.rootDirectory.contents.set('output', new host.rootDirectory.constructor(new Map()));
        return {};
      },
    });
    const files = collectFiles(host.rootDirectory), artifacts = [];
    for (const file of files.filter(file => file.name.startsWith('output/')).slice(0, 20)) {
      const mime = file.name.endsWith('.svg') ? 'image/svg+xml' : file.name.endsWith('.png') ? 'image/png' : 'application/octet-stream';
      artifacts.push({ kind: mime.startsWith('image/') ? 'image' : 'file', name: file.name.slice(7), data: file.data, mime });
    }
    send({ type: 'result', output, dataFiles: files, artifacts, elapsed: performance.now() - started,
      error: result.exitCode ? '程序退出码：' + result.exitCode : '', recycle: workspace.needsRecycle() });
    project=null;
  } catch (error) {
    if (input.type === 'packages') { signature = ''; artifact = null; send({ type: 'packages', error: String(error.message || error) }); }
    else send({ type: 'result', output, error: String(error.message || error), elapsed: started ? performance.now() - started : 0, recycle: true });
  }
};
function collectFiles(root) {
  const result = [];
  const visit = (directory, prefix = '', depth = 0) => {
    if (depth > 12) throw new Error('数据目录层级过深。');
    for (const [name, node] of directory.contents) {
      const path = nameOf(prefix + name);
      if (node.contents instanceof Map) visit(node, path + '/', depth + 1);
      else if (node.data instanceof Uint8Array) {
        if (result.length >= 128) throw new Error('代码数据超过 128 个文件。');
        result.push({ name: path, data: encode(node.data) });
      }
    }
  };
  visit(root);
  return result;
}
