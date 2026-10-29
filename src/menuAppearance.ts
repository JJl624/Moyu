import { Bold, ClipboardPaste, Code2, Columns3, Copy, Download, ExternalLink, FilePenLine, FolderOpen, Highlighter, IndentDecrease, IndentIncrease, Italic, Link, ListChecks, MoreHorizontal, PencilLine, Play, Quote, Rows3, Scissors, SquareFunction, Strikethrough, Table, Trash2, Underline, X } from 'lucide-react';
import { api } from './bridge';
const spec={
  copy:{Icon:Copy,section:'clipboard'}, cut:{Icon:Scissors,section:'clipboard',shortcut:'X'}, paste:{Icon:ClipboardPaste,section:'clipboard',shortcut:'V'},
  'format.bold':{Icon:Bold,section:'format'},'format.italic':{Icon:Italic,section:'format'},'format.strike':{Icon:Strikethrough,section:'format'},'format.code':{Icon:Code2,section:'format'},
  'format.highlight':{Icon:Highlighter,section:'format'},'format.underline':{Icon:Underline,section:'format'},'format.link':{Icon:Link,section:'format'},'format.math':{Icon:SquareFunction,section:'format'},
  'table.copy':{Icon:Table,section:'table'},'table.insert':{Icon:Table,section:'table'},'table.rowAfter':{Icon:Rows3,section:'table'},'table.columnAfter':{Icon:Columns3,section:'table'},
  'table.delete':{Icon:Trash2,section:'table',danger:true},'table.deleteRow':{Icon:Rows3,section:'table',danger:true},'table.deleteColumn':{Icon:Columns3,section:'table',danger:true},'table.deleteTable':{Icon:Trash2,section:'table',danger:true},'table.select':{Icon:Table,section:'table'},
  quote:{Icon:Quote,section:'structure'},'quote.default':{Icon:Quote,section:'structure'},unquote:{Icon:Quote,section:'structure'},indent:{Icon:IndentIncrease,section:'structure'},outdent:{Icon:IndentDecrease,section:'structure'},
  'code.run':{Icon:Play,section:'code'},'code.arguments':{Icon:Play,section:'code'},'code.format':{Icon:Code2,section:'code'},'code.data':{Icon:FolderOpen,section:'code'},
  open:{Icon:ExternalLink,section:'resource'},rename:{Icon:FilePenLine,section:'resource'},reveal:{Icon:FolderOpen,section:'resource'},delete:{Icon:Trash2,section:'resource',danger:true},
  'link.edit':{Icon:PencilLine,section:'resource'},
  'formula.edit':{Icon:SquareFunction,section:'structure'},
  link:{Icon:Link,section:'copy'},'copy.secondary':{Icon:Copy,section:'copy'},save:{Icon:Download,section:'save'},selectAll:{Icon:ListChecks,section:'selection',shortcut:'A'},close:{Icon:X,section:'document'},
  'insert.drawing':{Icon:PencilLine,section:'insert'},
} as const;
export function menuAppearance(id?:string):{Icon:typeof Copy;section:string;shortcut?:string;danger?:boolean}{
  if(id?.startsWith('copy.'))return {Icon:Copy,section:'copy'};
  const item=(spec[id as keyof typeof spec]||spec[id?.split('.')[0] as keyof typeof spec]) as {Icon:typeof Copy;section:string;shortcut?:string;danger?:boolean}|undefined;
  const result=item||{Icon:MoreHorizontal,section:'other'};
  return {...result,shortcut:result.shortcut?(api.platform==='darwin'?'⌘':'Ctrl+')+result.shortcut:undefined};
}
