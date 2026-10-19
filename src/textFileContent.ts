import { type EditorState, Facet, StateField, type Text } from '@codemirror/state';
// Keep CodeMirror's internal document normalized so Enter, paste and indentation
// share the same coordinates. Convert line endings only at the file boundary.
export const fileLineBreak = Facet.define<string, string>({ combine: values => values[0] || '\n' });
export const normalizedText = (text: string) => text.replace(/\r\n?|\n/g, '\n');
const originalFile = StateField.define<{ source: string; doc: Text; lineStarts: number[]; } | null>({
  create: () => null,
  update: value => value,
});
export const originalFileText = (source: string) =>
  originalFile.init(state => {
    const lineStarts = [0];
    for (const match of source.matchAll(/\r\n?|\n/g)) lineStarts.push(match.index + match[0].length);
    return { source, doc: state.doc, lineStarts };
  });
const restoredFile = (state: EditorState) => {
  const original = state.field(originalFile, false);
  return original?.doc.eq(state.doc) ? original : null;
};
export const fileText = (state: EditorState) =>
  restoredFile(state)?.source ?? state.doc.sliceString(0, state.doc.length, state.facet(fileLineBreak));
export const fileOffset = (state: EditorState, position: number) => {
  const pos = Math.max(0, Math.min(position, state.doc.length));
  const original = restoredFile(state), line = state.doc.lineAt(pos);
  if (original) return original.lineStarts[line.number - 1] + pos - line.from;
  return pos + (state.doc.lineAt(pos).number - 1) * (state.facet(fileLineBreak).length - 1);
};
export function editorOffset(state: EditorState, offset: number) {
  const original = restoredFile(state);
  if (original) {
    const at = Math.max(0, Math.min(offset, original.source.length));
    let first = 0, last = original.lineStarts.length - 1;
    while (first < last) {
      const middle = Math.ceil((first + last) / 2);
      if (original.lineStarts[middle] <= at) first = middle;
      else last = middle - 1;
    }
    const line = state.doc.line(first + 1);
    return Math.min(line.to, line.from + at - original.lineStarts[first]);
  }
  const extra = state.facet(fileLineBreak).length - 1;
  if (!extra) return Math.max(0, Math.min(offset, state.doc.length));
  let first = 1, last = state.doc.lines;
  while (first < last) {
    const number = Math.ceil((first + last) / 2), line = state.doc.line(number);
    if (line.from + (number - 1) * extra <= offset) first = number;
    else last = number - 1;
  }
  const line = state.doc.line(first);
  return Math.max(line.from, Math.min(line.to, offset - (first - 1) * extra));
}
