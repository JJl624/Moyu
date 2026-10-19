import { redo, undo } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup, EditorView } from 'codemirror';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { codeIndentation } from './editor/codeIndentation';
import { chineseEditorPhrases } from './editor/chinesePhrases';
import { prepareCodeContext } from './editor/codeContext';
import type { EditorHandle, EditorProps, EditorSelection } from './editorTypes';
import { fileLineBreak, fileText, normalizedText, originalFileText } from './textFileContent';
function capture(v: EditorView): EditorSelection {
  const { anchor, head } = v.state.selection.main;
  return {
    anchor,
    head,
    scrollTop: v.scrollDOM.scrollTop,
    mode: 'source',
    sourceScroll: v.scrollSnapshot(),
    sourceMarkdown: fileText(v.state),
  };
}
export default forwardRef<EditorHandle, EditorProps>(function TextFileEditor(props, ref) {
  const container = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callbacks = useRef(props);
  const local = useRef<{ path: string; selection: EditorSelection } | null>(null);
  callbacks.current = props;
  useLayoutEffect(() => {
    const language = new Compartment(),
      selected = local.current?.path === props.path ? local.current.selection : props.selection,
      length = normalizedText(props.value).length;
    const snapshot = selected?.sourceMarkdown === props.value ? selected.sourceScroll : undefined;
    const editor = new EditorView({
      parent: container.current!,
      scrollTo: snapshot,
      state: EditorState.create({
        doc: props.value,
        selection: selected
          ? { anchor: Math.min(selected.anchor, length), head: Math.min(selected.head, length) }
          : undefined,
        extensions: [
          basicSetup,
          chineseEditorPhrases,
          codeIndentation(),
          language.of([]),
          fileLineBreak.of(props.value.includes('\r\n') ? '\r\n' : '\n'),
          originalFileText(props.value),
          EditorState.readOnly.of(!!props.readOnly),
          EditorView.editable.of(!props.readOnly),
          ...(props.theme === 'dark' ? [oneDark] : []),
          EditorView.theme({
            '&': { height: '100%', background: 'transparent', fontSize: 'var(--size-source,13px)' },
            '.cm-scroller': {
              fontFamily: 'var(--font-source,var(--font-mono))',
              lineHeight: 'var(--line-source,1.85)',
            },
            '.cm-content': { padding: '16px 0' },
            '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)' },
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged) callbacks.current.onChange(fileText(u.state));
          }),
        ],
      }),
    });
    view.current = editor;
    if (!props.readOnly) editor.focus();
    if (selected && !snapshot) editor.scrollDOM.scrollTop = selected.scrollTop;
    const description = LanguageDescription.matchFilename(languages, props.path.split('/').pop()!);
    let alive = true;
    description?.load().then(extension => {
      if (alive) editor.dispatch({ effects: language.reconfigure(extension) });
    })
      .catch(() => {/* Plain text editing remains available if a parser cannot load. */});
    return () => {
      alive = false;
      local.current = { path: props.path, selection: capture(editor) };
      view.current = null;
      editor.destroy();
    };
  }, [props.path, props.theme, props.readOnly]);
  useLayoutEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== normalizedText(props.value)) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
    }
  }, [props.value]);
  useImperativeHandle(ref, () => ({
    prepareContext: (target, coords) => view.current ? prepareCodeContext(view.current, target, coords) : null,
    selectedText() {
      const v = view.current;
      if (!v) return '';
      const range = v.state.selection.main;
      return v.state.sliceDoc(range.from, range.to);
    },
    captureSelection() {
      return view.current ? capture(view.current) : null;
    },
    insert(text) {
      const v = view.current;
      if (!v || callbacks.current.readOnly) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    },
    action(action) {
      if (!view.current) return;
      if (action === 'undo') undo(view.current);
      else if (action === 'redo') redo(view.current);
    },
    focus() {
      view.current?.focus();
    },
    flush() {},
    scrollToHeading() {},
  }));
  return <div className='text-file-editor' ref={container} aria-label='文本编辑器' />;
});
