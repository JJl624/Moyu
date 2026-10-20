import { EditorSelection } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { codeBlocks } from '../codeBlocks';
import type { EditorContext } from '../editorTypes';
import { inlineActionText, inlineWrappers } from './inlineActions';
import { analyzeInlineFormats, inlineKinds, withoutInlineFormat, type InlineChange } from './inlineFormatState';
const formatCache = new WeakMap<EditorView,{doc:EditorView['state']['doc'];analysis:ReturnType<typeof analyzeInlineFormats>}>();

export function prepareCodeContext(
  view: EditorView,
  target: HTMLElement,
  coords?: { left: number; top: number },
  allowCaret = false,
): EditorContext | null {
  if (!view.dom.contains(target)) return null;
  const doc = view.state.doc;
  let selection = view.state.selection;
  const point = coords ? view.posAtCoords({ x: coords.left, y: coords.top }) : null;
  if (
    point !== null
    && (selection.main.empty || !selection.ranges.some(range => range.from <= point && range.to >= point))
  ) {
    selection = EditorSelection.single(point);
  }
  const source=doc.toString();
  const supportsInline = !view.state.readOnly && (allowCaret || !selection.main.empty)
    && !codeBlocks(source).some(block =>
      block.start <= selection.main.to && block.end >= selection.main.from
    );
  const cached=formatCache.get(view);
  let analysis=cached?.doc===doc?cached.analysis:undefined;
  if (supportsInline && !analysis) { analysis=analyzeInlineFormats(source,true);formatCache.set(view,{doc,analysis}); }
  const active=(action:string)=>!!inlineKinds[action]&&!!analysis&&selection.ranges.every(range=>analysis!.active(inlineKinds[action],range.from,range.to));
  return {
    text: selection.ranges.map(range => doc.sliceString(range.from, range.to)).join('\n'),
    textFor: () => '',
    canInsertDrawing: false,
    active,
    can: action => !!inlineWrappers[action] && supportsInline,
    run: action => {
      const wrapper = inlineWrappers[action];
      if (!wrapper || !supportsInline || view.state.doc !== doc || !view.dom.isConnected) return false;
      const remove=active(action);
      const edits:InlineChange[]=remove ? selection.ranges.flatMap(range=>analysis!.changes(inlineKinds[action],range.from,range.to)) : selection.ranges.map(range => ({
        from: range.from,
        to: range.to,
        insert: inlineActionText(action, withoutInlineFormat(doc.sliceString(range.from, range.to),inlineKinds[action])),
      }));
      const changes=[...new Map(edits.map(edit=>[edit.from+':'+edit.to,edit])).values()].sort((a,b)=>a.from-b.from);
      const transaction=view.state.changes(changes);
      view.dispatch({
        changes,
        annotations:isolateHistory.of('full'),
        selection: EditorSelection.single(
          remove?transaction.mapPos(selection.main.to,1):changes[0].from + (selection.main.empty ? wrapper[0].length : changes[0].insert.length - (action === 'link' ? 1 : 0)),
        ),
      });
      view.focus();
      return true;
    },
    restore: () => {
      if (view.state.doc !== doc || !view.dom.isConnected) return false;
      view.dispatch({ selection });
      view.focus();
      return true;
    },
  };
}
