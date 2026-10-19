type CompositionKey = {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

export function isComposingKey(event: CompositionKey) {
  const native = event.nativeEvent || event;
  return !!native.isComposing || native.keyCode === 229;
}
