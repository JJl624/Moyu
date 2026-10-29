export type EditorAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'highlight'
  | 'underline'
  | 'math'
  | 'link'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'table'
  | 'task'
  | 'codeblock'
  | 'divider'
  | 'undo'
  | 'redo'
  | 'rowAfter'
  | 'columnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'selectTable'
  | 'h1'
  | 'h2'
  | 'h3';
// Context actions operate on the clicked block.
export type BlockAction = 'paragraph' | 'indent' | 'outdent' | 'indentBlock' | 'outdentBlock' | 'unquote' | 'toggleFoldDefault' | 'paragraphBefore' | 'paragraphAfter';
export interface CodeContext {
  language: string;
  code: string;
  start?: number;
  id?:string;
  meta?:string;
  tab?: { index: number; language: string; code: string };
}
export interface EditorSelection {
  anchor: number;
  head: number;
  scrollTop: number;
  mode?: 'rich' | 'source';
  caretOffset?: number;
  markdown?: string;
  rich?: { anchor: number; head: number };
  source?: { anchor: number; head: number };
  sourceScroll?: import('@codemirror/state').StateEffect<unknown>;
  sourceMarkdown?: string;
  codeScroll?: { pos: number; top: number };
  codeTabs?: { pos: number; mode: 'tabs' | 'source'; index?: number };
  viewportAnchor?: { pos: number; offset: number };
}
export interface EditorHandle {
  prepareFormula?(target?:HTMLElement):import('./formulaSession').FormulaSession|null;
  selectionContext?(): EditorContext | null;
  prepareContext?(target: HTMLElement, coords: { left: number; top: number }): EditorContext | null;
  selectedText?(): string;
  canIndentIntoList?(target: HTMLElement): boolean;
  indentIntoList?(target: HTMLElement): void;
  canOutdentFromList?(target: HTMLElement): boolean;
  outdentFromList?(target: HTMLElement): void;
  prepareAttachmentDelete?(target: HTMLElement, coords: { left: number; top: number }): AttachmentDeletion | null;
  ensureCodeIds?(): string;
  captureSelection?(): EditorSelection | null;
  selectAt?(target: HTMLElement, coords?: { left: number; top: number }): void;
  restoreSelection?(selection: EditorSelection,options?:{focus?:boolean;viewport?:boolean}): void;
  codeAt?(target: HTMLElement): CodeContext | null;
  setCodeAttributes?(target:HTMLElement,expected:string,patch:Record<string,string>):boolean;
  replaceCode?(target: HTMLElement, code: string, expected: string, tabIndex?: number): boolean;
  scrollToCode?(id: string): void;
  scrollToOffset?(offset: number,options?:{focus?:boolean;top?:number;selectAttachment?:boolean}): void;
  visibleOffset?():number|undefined;
  canInsertDrawing?(): boolean;
  prepareDrawingInsert?(): { insert(raw: string): boolean; cancel(): void } | null;
  attachmentAt?(
    target: HTMLElement,
    coords: { left: number; top: number },
  ): {
    href: string;
    label: string;
    image: boolean;
    raw: string;
    wiki?: boolean;
    parameter?: string;
  } | null;
  action(action: EditorAction | BlockAction,options?:{focus?:boolean}): void;
  insert(text: string,options?:{focus?:boolean}): void;
  focus(): void;
  scrollToHeading(index: number): void;
  flush(): void;
}
// A menu owns an editor selection, not a viewport-restoration session.
export interface EditorContext {
  ancestors?: readonly string[];
  resource?: boolean;
  text: string;
  textFor(type: 'heading' | 'list_item' | 'blockquote' | 'table' | 'cell' | 'paragraph' | 'code_block' | 'math_block'): string;
  canInsertDrawing: boolean;
  active?(action: EditorAction | BlockAction): boolean;
  can(action: EditorAction | BlockAction): boolean;
  run(action: EditorAction | BlockAction,options?:{focus?:boolean}): boolean;
  restore(options?:{focus?:boolean}): boolean;
}
export interface AttachmentDeletion {
  valid(): boolean;
  remove(): boolean;
}
export interface EditorProps {
  root?: string;
  path: string;
  value: string;
  savedValue?: string;
  onChange(value: string): void;
  onError(message: string): void;
  theme: 'dark' | 'light';
  fontSize: number;
  readOnly?: boolean;
  autoFocus?: boolean;
  codeWrap?: boolean;
  selection?: EditorSelection | null;
  onDrawing?(): void;
  onScore?(): void;
  onDrawingAllowed?(allowed: boolean): void;
  onContextChange?(): void;
}

