const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

// Keep ProseMirror constructors shared with tests; bundle only app modules.
module.exports = async function editorModule(file) {
  const source = path.resolve(__dirname, '../../src/editor', Array.isArray(file) ? file[0] : file);
  const contents = Array.isArray(file)
    ? file.map(name => 'export * from ' + JSON.stringify('./' + name) + ';').join('\n')
    : fs.readFileSync(source, 'utf8');
  const {build} = require('esbuild');
  const result = await build({
    stdin: {contents, loader: 'ts', sourcefile: Array.isArray(file) ? path.join(path.dirname(source), '__test_exports__.ts') : source, resolveDir: path.dirname(source)},
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{name: 'shared-prosemirror', setup(builder) {
      builder.onResolve({filter: /^@milkdown\//}, async args => {
        if (args.pluginData?.resolving) return;
        const resolved = await builder.resolve(args.path, {kind: 'import-statement', resolveDir: path.dirname(source), pluginData: {resolving: true}});
        return resolved.errors.length ? {errors: resolved.errors} : {path: pathToFileURL(resolved.path).href, external: true};
      });
    }}],
  });
  const code = result.outputFiles[0].text + '\n//# sourceURL=' + pathToFileURL(source).href;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
