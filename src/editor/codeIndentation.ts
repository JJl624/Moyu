import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { ViewPlugin, keymap } from '@codemirror/view';
import { settingsStore } from '../settingsStore';
export function codeIndentWidth() {
  const value = Number(settingsStore.getItem('moyu-code-indent') || 2);
  return Number.isInteger(value) && value >= 1 && value <= 16 ? value : 2;
}
export function setCodeIndentWidth(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 16) return;
  settingsStore.setItem('moyu-code-indent', String(value));
  window.dispatchEvent(new Event('moyu-code-indent'));
}
export function codeIndentation() {
  const compartment = new Compartment();
  const options = () => [indentUnit.of(' '.repeat(codeIndentWidth())), EditorState.tabSize.of(codeIndentWidth())];
  return [
    compartment.of(options()),
    Prec.high(keymap.of([indentWithTab])),
    ViewPlugin.define(view => {
      const update = () => view.dispatch({ effects: compartment.reconfigure(options()) });
      window.addEventListener('moyu-code-indent', update);
      return { destroy: () => window.removeEventListener('moyu-code-indent', update) };
    }),
  ];
}
