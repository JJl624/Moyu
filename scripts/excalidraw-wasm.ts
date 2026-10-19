import { fontBindingsWithoutEval } from './excalidraw-csp.ts';

type EmitAsset = (name: string, bytes: Buffer) => string;

// Excalidraw ships these binaries as base64 JavaScript literals. Keep its lazy
// subsetters, but let Vite package the original bytes as local Wasm assets.
export function externalizeFontWasm(code: string, emit: EmitAsset): string {
  if (!code.includes('var woff2_wasm_default =')) return code;
  for (const name of ['woff2', 'harfbuzz']) {
    const variable = `${name}_wasm_default`;
    const expression = new RegExp('var ' + variable + ' = __toBinary\\d*\\(`([A-Za-z0-9+/=\\r\\n]+)`\\);');
    const match = expression.exec(code);
    if (!match) throw new Error(`Excalidraw ${name} Wasm integration needs review`);
    const bytes = Buffer.from(match[1], 'base64');
    if (!WebAssembly.validate(bytes)) throw new Error(`Invalid Excalidraw ${name} Wasm`);
    const reference = emit(`excalidraw-${name}.wasm`, bytes);
    code = code.replace(expression, `var ${variable} = async () => {
      const response = await fetch(import.meta.ROLLUP_FILE_URL_${reference});
      if (!response.ok) throw new Error('无法加载绘图字体处理组件。');
      return new Uint8Array(await response.arrayBuffer());
    };`);
  }
  const load = 'var load = () => {';
  const binding = 'wasmBinary: woff2_wasm_default';
  const instantiate = 'WebAssembly.instantiate(harfbuzz_wasm_default)';
  if (!code.includes(load) || !code.includes(binding) || !code.includes(instantiate)) {
    throw new Error('Excalidraw font subsetter integration needs review');
  }
  return fontBindingsWithoutEval(code.replace(load, 'var load = async () => {\n  const binary = await woff2_wasm_default();')
    .replace(binding, 'wasmBinary: binary')
    .replace(instantiate, 'WebAssembly.instantiate(await harfbuzz_wasm_default())'));
}
