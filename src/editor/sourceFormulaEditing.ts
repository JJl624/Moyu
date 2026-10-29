import {Transaction} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import type {EditorView} from '@codemirror/view';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import {unified} from 'unified';
import type {InlineAst} from '../inlineSyntax';
import type {FormulaSession} from '../formulaSession';
import {focusSourceEditor} from './sourceSelectionOwnership';
const parser=unified().use(remarkParse).use(remarkMath);

export function prepareSourceFormula(view:EditorView):FormulaSession|null{
  if(view.state.readOnly||view.composing||!view.dom.isConnected)return null;
  const doc=view.state.doc,selection=view.state.selection.main,source=doc.toString();
  let formula:InlineAst|undefined,blocked=false;
  const walk=(node:InlineAst)=>{
    const from=node.position?.start.offset,to=node.position?.end.offset;
    const contains=from!==undefined&&to!==undefined&&selection.from>=from&&selection.to<=to;
    if(contains&&['math','inlineMath'].includes(node.type)){formula=node;return;}
    if(contains&&['code','inlineCode'].includes(node.type)){blocked=true;return;}
    node.children?.forEach(walk);
  };
  walk(parser.parse(source) as InlineAst);
  if(!formula&&(blocked||doc.lineAt(selection.from).number!==doc.lineAt(selection.to).number))return null;
  const display=formula?.type==='math';let from=formula?.position?.start.offset??selection.from,to=formula?.position?.end.offset??selection.to;
  let prefix='';
  if(display){
    const line=doc.lineAt(from);prefix=source.slice(line.from,from).replace(/(^|>\s*)(?:[-+*]|\d+[.)])\s+/g,part=>part.replace(/[^>\s]/g,' '));
    from=source.indexOf('\n',from)+1;to=source.lastIndexOf('\n',to-1)+1;
    if(from===0||to<from)return null;
  }
  const value=formula?.value??doc.sliceString(from,to);let used=false,expected=doc;
  return {value,display,
    restore(){if(view.dom.isConnected&&view.state.doc===expected)focusSourceEditor(view,'restore');},
    apply(latex){
      if(used||!view.dom.isConnected||view.state.readOnly||view.composing||view.state.doc!==doc)return false;used=true;
      if(formula&&latex===value)return true;
      const insert=display?latex.split(/\r?\n/).map(line=>prefix+line).join('\n')+'\n':'$'+latex.replace(/\r?\n/g,' ')+'$';
      if(doc.sliceString(from,to)!==insert)view.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length},annotations:[Transaction.userEvent.of('input.formula'),Transaction.addToHistory.of(true),isolateHistory.of('full')]});
      expected=view.state.doc;return true;
    },
  };
}
