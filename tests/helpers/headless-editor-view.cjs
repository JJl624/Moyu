// Model-command tests use this DOM-free view. Geometry and real input ownership
// are verified separately by browser and native-device regressions.
module.exports = function headlessEditorView(state) {
  return {
    state, editable: true, composing: false, isDestroyed: false, focusCount: 0,
    dom: {closest: () => null, ownerDocument: {
      documentElement: {dataset: {}}, activeElement: null, getSelection: () => null,
    }},
    hasFocus: () => true,
    focus() { this.focusCount++; },
    dispatch(transaction) { this.state = this.state.apply(transaction); },
  };
};
