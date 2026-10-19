const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const Module = require('node:module');
const output = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../scripts/excalidraw-csp.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const helper = new Module(__filename);
helper._compile(output, __filename);
const original = fs.readFileSync(path.resolve(__dirname, '../node_modules/@excalidraw/excalidraw/dist/dev/chunk-OKSO7T74.js'), 'utf8');
const sources = [original, helper.exports.fontBindingsWithoutEval(original)];
const names = ['createNamedFunction', 'makeDynCaller', 'craftInvokerFunction'];
function functions(source, allowEval) {
  const ast = ts.createSourceFile('bindings.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 3);
  const context = vm.createContext({ signature: 'iii', rawFunction: 7,
    makeLegalFunctionName: name => name.replace(/[^a-zA-Z0-9_]/g, '$'),
    new_: (constructor, args) => Reflect.construct(constructor, args),
    throwBindingError(message) { throw Error(message); },
    runDestructors(stack) { while (stack.length) { const value = stack.pop(); stack.pop()(value); } },
  }, { codeGeneration: { strings: allowEval, wasm: false } });
  return vm.runInContext(found.join('\n') + '\n({createNamedFunction,makeDynCaller,craftInvokerFunction})', context);
}

test('static font wrappers preserve constructor receiver, names and dynamic call arity with eval disabled', () => {
  for (let i = 0; i < sources.length; i++) {
    const api = functions(sources[i], i === 0);
    const named = api.createNamedFunction('FontVector', function(value) { this.value = value; });
    assert.equal(named.name, 'FontVector');
    assert.equal(new named(42).value, 42);
    const dyn = api.makeDynCaller((...args) => args);
    assert.equal(dyn.length, 2);
    assert.deepEqual(Array.from(dyn(3)), [7, 3, undefined]);
    assert.deepEqual(Array.from(dyn(3, 4, 5)), [7, 3, 4]);
  }
});

test('wire conversion, method receivers, destructor order and arity errors agree with upstream', () => {
  const results = sources.map((source, index) => {
    const api = functions(source, index === 0), log = [];
    const resultType = { name: 'int', fromWireType(value) { log.push('return'); return value + 1; } };
    const scalar = { destructorFunction: null, toWireType(_stack, value) { log.push('scalar'); return value * 2; } };
    const owned = { toWireType(_stack, value) { log.push('owned'); return value + 3; }, destructorFunction(value) { log.push('destroy:' + value); } };
    const invoke = (target, ...values) => { log.push('invoke:' + target); return values.reduce((sum, value) => sum + value, 0); };
    const free = api.craftInvokerFunction('free', [resultType, null, scalar, owned], null, invoke, 7);
    const result = free(2, 3);
    assert.equal(free.length, 2);
    assert.throws(() => free(2), /expected 2 args/);
    const receiver = { toWireType(stack, value) { stack.push(number => log.push('receiver:' + number), value.number); return value.number; } };
    const method = api.craftInvokerFunction('method', [{ name: 'void' }, receiver, scalar], {}, invoke, 8);
    assert.equal(method.call({ number: 9 }, 2), undefined);
    assert.equal(method.length, 1);
    return { result, log };
  });
  assert.deepEqual(results[1], results[0]);
  assert.equal(results[1].result, 11);
  assert.deepEqual(results[1].log, ['scalar', 'owned', 'invoke:7', 'destroy:6', 'return', 'scalar', 'invoke:8', 'receiver:9']);
});
