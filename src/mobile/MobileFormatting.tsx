import {Bold,Italic,Strikethrough,Code,Highlighter,Underline,Sigma,Link,Quote,ChevronsDown,Code2,Table2,Minus,Rows3,Columns3,Settings2,PanelsTopLeft,TextCursorInput,Paperclip,Heading1,Heading2,Heading3,List,ListOrdered,ListTodo,Trash2,IndentIncrease,IndentDecrease,TextQuote,Type,Copy,Brackets,type LucideIcon} from 'lucide-react';
import type {EditorAction,BlockAction} from '../editorTypes';
export type MobileFormatAction=EditorAction|BlockAction|'foldClosed'|'foldOpen'|'tabs'|'attachment'|'mathblock'|'copyTable';
export type MobileFormat={action:MobileFormatAction;label:string;icon:LucideIcon;context?:'table'|'block'|'query';short?:string};
export type MobileFormatState={ancestors:readonly string[];resource?:boolean;can:Partial<Record<MobileFormatAction,boolean>>;active:Partial<Record<MobileFormatAction,boolean>>};
export const emptyFormatState:MobileFormatState={ancestors:[],can:{},active:{}};
export const quickFormats:MobileFormat[]=[{action:'bold',label:'加粗',icon:Bold,context:'query'},{action:'italic',label:'斜体',icon:Italic,context:'query'},{action:'underline',label:'下划线',icon:Underline,context:'query'},{action:'highlight',label:'高亮',icon:Highlighter,context:'query'},{action:'strike',label:'删除线',icon:Strikethrough,context:'query'},{action:'code',label:'行内代码',icon:Code,context:'query'}];
export const formatGroups:{label:string;items:MobileFormat[]}[]=[
  {label:'文字样式',items:[...quickFormats,{action:'math',label:'行内公式',icon:Sigma,context:'query'},{action:'link',label:'链接',icon:Link,context:'query'}]},
  {label:'段落样式',items:[{action:'paragraph',label:'正文',icon:Type,context:'query'},{action:'h1',label:'一级标题',icon:Heading1},{action:'h2',label:'二级标题',icon:Heading2},{action:'h3',label:'三级标题',icon:Heading3},{action:'bullet',label:'无序列表',icon:List},{action:'ordered',label:'有序列表',icon:ListOrdered},{action:'task',label:'任务列表',icon:ListTodo},{action:'quote',label:'引用',icon:Quote},{action:'foldClosed',label:'折叠引用',icon:TextQuote}]},
  {label:'插入',items:[{action:'table',label:'表格',icon:Table2},{action:'codeblock',label:'代码块',icon:Code2},{action:'tabs',label:'标签页',icon:PanelsTopLeft},{action:'mathblock',label:'行间公式',icon:Brackets},{action:'divider',label:'分隔线',icon:Minus},{action:'attachment',label:'插入附件',icon:Paperclip}]},
  {label:'列表与引用',items:[{action:'indent',label:'增加缩进',short:'缩进',icon:IndentIncrease,context:'query'},{action:'outdent',label:'减少缩进',short:'退一级',icon:IndentDecrease,context:'query'},{action:'indentBlock',label:'缩进至列表',short:'入列表',icon:IndentIncrease,context:'query'},{action:'outdentBlock',label:'脱离列表',short:'脱离',icon:IndentDecrease,context:'query'},{action:'unquote',label:'去除一层引用',short:'去引用',icon:TextQuote,context:'query'},{action:'toggleFoldDefault',label:'默认展开',short:'默认展开',icon:ChevronsDown,context:'query'}]},
  {label:'表格操作',items:[{action:'rowAfter',label:'添加行',short:'加行',icon:Rows3,context:'table'},{action:'columnAfter',label:'添加列',short:'加列',icon:Columns3,context:'table'},{action:'deleteRow',label:'删除行',short:'删行',icon:Rows3,context:'table'},{action:'deleteColumn',label:'删除列',short:'删列',icon:Columns3,context:'table'},{action:'deleteTable',label:'删除表格',short:'删表格',icon:Trash2,context:'table'}]},
  {label:'块操作',items:[{action:'paragraphAfter',label:'块后换行',short:'块后换行',icon:TextCursorInput,context:'block'}]},
];
export const formatLabel=(item:MobileFormat,open:boolean|undefined)=>item.action==='toggleFoldDefault'&&open?'默认折叠':item.label;
export const allFormats=formatGroups.flatMap(group=>group.items);
const copyTable:MobileFormat={action:'copyTable',label:'复制表格',short:'复制表格',icon:Copy,context:'query'};
export const contextFormats=[...allFormats.filter(item=>!!item.context),copyTable];
export const copyTypes={copyTable:'table'} as const;
export function shortcutOrder(raw:string|null):string[]{
  let saved:unknown;try{saved=JSON.parse(raw||'null');}catch{saved=null;}
  return [...new Set(Array.isArray(saved)?saved.filter((key):key is string=>typeof key==='string'&&allFormats.some(item=>item.action===key)):quickFormats.map(item=>item.action))];
}
export const sortedFormats=(order:string[])=>order.flatMap(action=>allFormats.filter(item=>item.action===action));
export function formatEnabled(item:MobileFormat,state:MobileFormatState){
  if(item.context)return !!state.can[item.action];
  return !state.ancestors.some(type=>type==='code_block'||type==='math_block');
}
export function automaticFormats(state:MobileFormatState){
  const inside=(type:string)=>state.ancestors.includes(type),resource=state.resource||['table','code_block','math_block'].some(inside);
  const actions:MobileFormatAction[]=[];
  if(inside('table'))actions.push('rowAfter','columnAfter','paragraphAfter','outdentBlock','indentBlock','copyTable','deleteRow','deleteColumn','deleteTable');
  else if(resource)actions.push('paragraphAfter','outdentBlock','indentBlock');
  else if(inside('list_item'))actions.push('indent','outdent');
  else if(state.can.indentBlock)actions.push('indentBlock');
  if(inside('blockquote'))actions.push('unquote','toggleFoldDefault');
  return actions.flatMap(action=>contextFormats.filter(item=>item.action===action&&formatEnabled(item,state)));
}
export function MobileFormatting({run,state,foldState,configure}:{run(action:MobileFormatAction):void;state:MobileFormatState;foldState:boolean|null;configure():void}){
  return <div className='mobile-format-sections'><div className='mobile-format-heading'><span>文字样式</span><button aria-label='自定义工具栏' onClick={configure}><Settings2 size={17}/>工具栏</button></div>{formatGroups.map(group=><section key={group.label}>{group.label!=='文字样式'&&<h3>{group.label}</h3>}<div className='mobile-format-grid'>{group.items.map(item=><button key={item.action} aria-label={formatLabel(item,foldState??undefined)} disabled={item.action==='toggleFoldDefault'?foldState===null:!formatEnabled(item,state)} aria-pressed={item.action==='foldOpen'?foldState===null?undefined:foldState:item.action==='foldClosed'?foldState===null?undefined:!foldState:state.active[item.action]} onClick={()=>run(item.action)}><item.icon size={21}/><span>{formatLabel(item,foldState??undefined)}</span></button>)}</div></section>)}</div>;
}
