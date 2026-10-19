// Static equivalents of this pinned Emscripten build's generated wrappers.
// Keep arity, receiver, wire conversion and destructor order without eval.
export function fontBindingsWithoutEval(code: string): string {
  const wrappers: [RegExp, string][] = [
    [/function createNamedFunction\(name, body\) \{[\s\S]*?\n    \}(?=\n    function extendError)/, `function createNamedFunction(name, body) {
      const wrapped = function(...args) { return body.apply(this, args); };
      Object.defineProperty(wrapped, "name", { value: makeLegalFunctionName(name), configurable: true });
      return wrapped;
    }`],
    [/function makeDynCaller\(dynCall\) \{[\s\S]*?\n      \}(?=\n      let fp;)/, `function makeDynCaller(dynCall) {
        const arity = signature.length - 1;
        const wrapped = createNamedFunction("dynCall_" + signature + "_" + rawFunction, function(...args) {
          const values = Array.from({length: arity}, (_, i) => args[i]);
          return dynCall(rawFunction, ...values);
        });
        Object.defineProperty(wrapped, "length", {value: arity, configurable: true});
        return wrapped;
      }`],
    [/function craftInvokerFunction\(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc\) \{[\s\S]*?\n    \}(?=\n    function __embind_register_class_function)/, `function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
      if (argTypes.length < 2) throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
      const isMethod = argTypes[1] !== null && classType !== null;
      const needsStack = argTypes.slice(1).some(type => type !== null && type.destructorFunction === undefined);
      const arity = argTypes.length - 2;
      const wrapped = createNamedFunction(humanName, function(...args) {
        if (args.length !== arity) throwBindingError("function " + humanName + " called with " + args.length + " arguments, expected " + arity + " args!");
        const destructors = needsStack ? [] : null;
        const wired = [];
        if (isMethod) wired.push(argTypes[1].toWireType(destructors, this));
        for (let i = 2; i < argTypes.length; i++) wired.push(argTypes[i].toWireType(destructors, args[i - 2]));
        const result = cppInvokerFunc(cppTargetFunc, ...wired);
        if (needsStack) runDestructors(destructors);
        else {
          let index = 0;
          for (let i = isMethod ? 1 : 2; i < argTypes.length; i++) {
            const destroy = argTypes[i].destructorFunction;
            if (destroy !== null) destroy(wired[index]);
            index++;
          }
        }
        if (argTypes[0].name !== "void") return argTypes[0].fromWireType(result);
      });
      Object.defineProperty(wrapped, "length", {value: arity, configurable: true});
      return wrapped;
    }`],
  ];
  for (const [pattern, replacement] of wrappers) {
    if (!pattern.test(code)) throw new Error('Excalidraw CSP integration needs review');
    code = code.replace(pattern, () => replacement);
  }
  return code;
}
