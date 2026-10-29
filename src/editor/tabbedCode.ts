import { Compartment, EditorState, Prec } from '@codemirror/state';
import {codeBlockSelection} from './codeBlockSelection';
import {mayFocusSelection,registerCodeFocus} from './codeSelection';
import {clampCodeRange, type FocusIntent} from './selectionPolicy';
import {focusEditorSelection} from './selectionOwnership';
import {codeLanguageMenu} from './codeLanguageMenu';
import { EditorView as CodeView, keymap, type ViewUpdate } from '@codemirror/view';
import {
  type CodeBlockConfig,
  codeBlockConfig,
  CodeMirrorBlock,
} from '@milkdown/kit/component/code-block';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { closeHistory, redo, undo } from '@milkdown/kit/prose/history';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';
import { api } from '../bridge';
import {
  type CodeTab,
  createCodeTab,
  isTabbedCode,
  moveCodeTab,
  parseCodeTabs,
  removeCodeTab,
  renameCodeTab,
  editCodeTab,
  tabAtOffset,
} from '../codeTabs';
import { codeLanguage } from '../highlight';
import { codeTabPreview } from '../tabbedCodePreview';
import { heightFromMeta } from './codeMetadata';
import { isComposingKey } from '../keyboardComposition';
import {keepClosedKeyboard} from './controlFocus';

function button(label: string, text: string, action: () => void) {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = label;
  el.setAttribute('aria-label', label);
  el.textContent = text;
  el.addEventListener('pointerdown',event=>{if(el.closest('.mobile-app')){keepClosedKeyboard(el);event.preventDefault();}});
  el.addEventListener('click', action);
  return el;
}

// Only one CodeMirror is mounted per block. Tab documents stay in the fence's
// source, and CodeMirror offsets are translated into that single PM text node.
class TabbedCodeView implements NodeView {
  dom = document.createElement('div');
  private frame = document.createElement('div');
  private bar = document.createElement('div');
  private pages = document.createElement('div');
  private manage = document.createElement('div');
  private manageButton:HTMLButtonElement|undefined;
  private language = document.createElement('input');
  private title = document.createElement('input');
  private toggle: HTMLButtonElement;
  private cm: CodeView;
  private languageConf = new Compartment();
  private readOnlyConf = new Compartment();
  private active = 0;
  private sourceMode = false;
  private syncing = false;
  private destroyed = false;
  private languageRevision = 0;
  private loadedLanguage = '';
  private selections = new Map<number, { anchor: number; head: number; scroll: number }>();
  private preview = document.createElement('div');
  private previewRevision = 0;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private previewKey = '';
  private renderQueued = false;
  private separateNextEdit = false;
  private barKey = '';
  private parsedSource: string | null = null;
  private parsed: CodeTab[] = [];

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
    private config: CodeBlockConfig,
  ) {
    this.sourceMode=!node.textContent.trim();
    this.dom.className = 'milkdown-code-block tabbed-code';
    this.dom.contentEditable = 'false';
    this.dom.dataset.tabbedCode = 'true';
    const tools = document.createElement('div');
    tools.className = 'tools';
    const lang = document.createElement('span');
    lang.className = 'language-button';
    lang.textContent = 'Tabs';
    const actions = document.createElement('div');
    actions.className = 'tools-button-group';
    this.toggle = button('显示源码', '源码', () => this.setMode(!this.sourceMode,!this.dom.closest('.mobile-app')));
    const copy = button('复制代码', '', () => {
      const text = this.sourceMode ? this.node.textContent : this.tabs()[this.active]?.code || '';
      void (api.desktop
        ? api.feature('clipboard.write', { text })
        : navigator.clipboard.writeText(text))
        .then(() => this.config.onCopy?.(text)).catch(console.error);
    });
    copy.className = 'copy-button';
    copy.innerHTML = config.copyIcon;
    copy.append(document.createTextNode(config.copyText));
    actions.append(this.toggle, copy);
    tools.append(lang, actions);
    this.frame.className = 'tabs-frame';
    const height = heightFromMeta(node.attrs.meta || '');
    if (height) this.frame.style.height = height + 'px';
    this.bar.className = 'tabs-bar';
    this.bar.setAttribute('role', 'tablist');
    this.bar.setAttribute('aria-label', '代码标签页');
    this.pages.className = 'tabs-editor';
    this.pages.id = 'tabs-panel-' + crypto.randomUUID();
    this.pages.setAttribute('role', 'tabpanel');
    this.manage.className = 'tabs-management';
    this.manage.id='tabs-management-'+crypto.randomUUID();
    this.manage.hidden = true;
    this.language.setAttribute('aria-label', '标签页语言');
    this.language.placeholder = '语言';
    this.title.setAttribute('aria-label', '标签页标题');
    this.title.placeholder = '标题（可选）';
    this.language.spellcheck = this.title.spellcheck = false;
    const list = document.createElement('datalist');
    list.id = 'tabs-languages-' + crypto.randomUUID();
    for (const item of config.languages) {
      const option = document.createElement('option');
      option.value = item.name;
      list.append(option);
    }
    this.language.setAttribute('list', list.id);
    const apply = () => {
      const source = renameCodeTab(
        this.node.textContent,
        this.active,
        this.language.value.trim(),
        this.title.value,
      );
      this.language.setAttribute('aria-invalid', String(source === null));
      if (source !== null) this.changeSource(source, this.active);
    };
    for (const input of [this.language, this.title]) {
      input.addEventListener('change', apply);
      input.addEventListener('keydown', e => {
        if (isComposingKey(e)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
          this.cm.focus();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.setManagement(false);
          if(mayFocusSelection(this.view,'restore'))this.cm.focus();
        }
      });
    }
    this.manage.append(
      this.language,
      this.title,
      button('向左移动标签页', '←', () => this.move(-1)),
      button('向右移动标签页', '→', () => this.move(1)),
      button('删除标签页', '删除', () =>
        this.changeSource(
          removeCodeTab(this.node.textContent, this.active),
          Math.max(0, this.active - 1),
        )),
      list,
    );
    this.frame.append(this.bar, this.manage, this.pages);
    this.dom.append(tools, this.frame);
    this.cm = new CodeView({
      parent: this.pages,
      root: view.root,
      doc: '',
      extensions: [
        this.languageConf.of([]),
        this.readOnlyConf.of(EditorState.readOnly.of(!view.editable)),
        EditorState.changeFilter.of(() => this.syncing || view.editable),
        Prec.highest(keymap.of([
          {
            key: 'Mod-z',
            run: () => undo(view.state, view.dispatch),
            shift: () => redo(view.state, view.dispatch),
          },
          { key: 'Mod-y', run: () => redo(view.state, view.dispatch) },
          { key: 'ArrowUp', run: () => this.escapeBefore('line') },
          { key: 'ArrowLeft', run: () => this.escapeBefore('char') },
        ])),
        ...config.extensions,
        CodeView.updateListener.of(update => this.forwardUpdate(update)),
      ],
    });
    this.preview.className = 'tabs-live-preview';
    this.preview.hidden = true;
    this.pages.append(this.preview);
    this.dom.addEventListener('moyu-tabs-display', this.restoreMode);
    this.render();
  }
  private restoreMode = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (Number.isInteger(detail?.index)) {
      this.active = Math.max(0, Math.min(this.tabs().length - 1, detail.index));
    }
    this.setMode((typeof detail === 'string' ? detail : detail?.mode) === 'source', false);
    this.render();
  };
  private tabs() {
    if (this.parsedSource !== this.node.textContent) {
      this.parsedSource = this.node.textContent;
      this.parsed = parseCodeTabs(this.parsedSource);
    }
    return this.parsed;
  }
  private offset() {
    return this.sourceMode ? 0 : this.tabs()[this.active]?.from ?? 0;
  }
  private escapeBefore(unit: 'line' | 'char') {
    const sel = this.cm.state.selection.main;
    if (!sel.empty || (unit === 'line' ? this.cm.state.doc.lineAt(sel.head).from : sel.head) > 0) {
      return false;
    }
    const pos = this.getPos();
    if (pos === undefined) return false;
    this.view.dispatch(
      this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(pos), -1))
        .scrollIntoView(),
    );
    focusEditorSelection(this.view,'edit');
    return true;
  }
  private remember() {
    if (!this.sourceMode) {
      const { anchor, head } = this.cm.state.selection.main;
      this.selections.set(this.active, { anchor, head, scroll: this.pages.scrollTop });
    }
  }
  private select(index: number) {
    const focus=this.cm.hasFocus||!this.dom.closest('.mobile-app');
    this.remember();
    this.active = index;
    this.render();
    const saved = this.selections.get(index);
    if (saved) this.setCodeSelection(saved.anchor, saved.head);
    else this.setCodeSelection(0, 0);
    this.pages.scrollTop = saved?.scroll ?? 0;
    if(focus){this.cm.focus();this.forwardSelection();}
  }
  private setMode(source: boolean, focus = true) {
    if (source === this.sourceMode) return;
    const sel = this.cm.state.selection.main,
      anchor = this.offset() + sel.anchor,
      head = this.offset() + sel.head;
    this.remember();
    this.sourceMode = source;
    if (!source) this.active = tabAtOffset(this.tabs(), head, this.active);
    this.render();
    this.setCodeSelection(anchor - this.offset(), head - this.offset());
    if (focus) {
      this.cm.focus();
      this.forwardSelection();
    }
  }
  private setManagement(open:boolean,focus=false){
    this.manage.hidden=!open;
    this.manageButton?.setAttribute('aria-expanded',String(open));
    this.manageButton?.setAttribute('aria-pressed',String(open));
    if(!open)return;
    if(focus)this.title.focus({preventScroll:true});
    if(this.dom.closest('.mobile-app'))requestAnimationFrame(()=>{
      if(this.destroyed||this.manage.hidden)return;const scroll=this.dom.closest<HTMLElement>('.mobile-document');if(!scroll)return;
      const box=this.manage.getBoundingClientRect(),viewport=scroll.getBoundingClientRect();
      if(box.bottom>viewport.bottom-12)scroll.scrollTop+=box.bottom-viewport.bottom+12;
      else if(box.top<viewport.top+8)scroll.scrollTop+=box.top-viewport.top-8;
    });
  }
  private setCodeSelection(anchor: number, head: number) {
    const range = clampCodeRange(anchor, head, this.cm.state.doc.length);
    const current=this.cm.state.selection.main;
    if(current.anchor===range.anchor&&current.head===range.head)return;
    this.syncing = true;
    try {
      this.cm.dispatch({
        selection: range,
      });
    } finally {
      this.syncing = false;
    }
  }
  private forwardSelection() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { anchor, head } = this.cm.state.selection.main, offset = pos + 1 + this.offset();
    const selection = this.view.state.selection;
    if (selection.anchor !== offset + anchor || selection.head !== offset + head) {
      this.view.dispatch(
        this.view.state.tr.setSelection(
          TextSelection.create(this.view.state.doc, offset + anchor, offset + head),
        ),
      );
    }
  }
  private forwardUpdate(update: ViewUpdate) {
    if (this.syncing || this.destroyed) return;
    if (update.docChanged) {
      const previous = this.tabs(), origin = previous[this.active];
      const edited = this.sourceMode
        ? {source:update.state.doc.toString(),offset:0}
        : editCodeTab(this.node.textContent, this.active, update.state.doc.toString());
      const source=edited.source;
      const next = parseCodeTabs(source);
      const offset = edited.offset;
      const head = offset + update.state.selection.main.head;
      const newDeclaration = !this.sourceMode && next.length > previous.length
        ? next.findIndex(tab =>
          tab.declarationFrom !== null && tab.declarationFrom >= (origin?.from ?? 0)
          && tab.declarationTo === head && !tab.language
        )
        : -1;
      this.syncing = true;
      try {
        this.write(
          source,
          offset + update.state.selection.main.anchor,
          offset + update.state.selection.main.head,
          false,
        );
      } finally {
        this.syncing = false;
      }
      if (newDeclaration >= 0) {
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.active = newDeclaration;
          this.render();
          this.setManagement(true);
          if(!this.dom.closest('.mobile-app'))this.language.focus({ preventScroll: true });
        });
      }
    } else if (update.selectionSet && this.cm.hasFocus) {
      this.syncing = true;
      try {
        this.forwardSelection();
      } finally {
        this.syncing = false;
      }
    }
  }
  private write(source: string, anchor: number, head = anchor, separate = true) {
    const pos = this.getPos();
    if (pos === undefined || !this.view.editable) return;
    const tr = this.view.state.tr;
    if (source !== this.node.textContent) {
      // Preserve the unchanged prefix/suffix, so selections elsewhere and PM
      // history remain stable when a tab or its title changes.
      const old = this.node.textContent;
      let from = 0, tail = 0;
      while (from < old.length && from < source.length && old[from] === source[from]) from++;
      while (
        tail < old.length - from && tail < source.length - from
        && old[old.length - 1 - tail] === source[source.length - 1 - tail]
      ) tail++;
      tr.insertText(
        source.slice(from, source.length - tail),
        pos + 1 + from,
        pos + 1 + old.length - tail,
      );
    }
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + anchor, pos + 1 + head));
    if (separate || this.separateNextEdit) closeHistory(tr);
    this.separateNextEdit = separate;
    this.view.dispatch(tr);
  }
  private changeSource(source: string, active: number) {
    if (source === this.node.textContent) return;
    this.active = active;
    this.selections.clear();
    this.write(source, parseCodeTabs(source)[active]?.from ?? 0);
    this.render();
  }
  private move(direction: -1 | 1) {
    const next = moveCodeTab(this.node.textContent, this.active, direction);
    if (next !== this.node.textContent) this.changeSource(next, this.active + direction);
  }
  private render() {
    const tabs = this.tabs();
    this.active = Math.max(0, Math.min(this.active, tabs.length - 1));
    this.dom.dataset.tabsDisplay = this.sourceMode ? 'source' : 'tabs';
    this.dom.dataset.codeTabIndex = String(this.active);
    this.toggle.textContent = this.sourceMode ? '标签页' : '源码';
    this.toggle.title = this.sourceMode ? '显示标签页' : '显示源码';
    this.toggle.setAttribute('aria-label', this.toggle.title);
    this.bar.hidden = this.sourceMode;
    const barKey = JSON.stringify([
      tabs.map(tab => [tab.language, tab.title]),
      this.active,
      this.view.editable,
    ]);
    if (barKey !== this.barKey) {
      this.barKey = barKey;
      const buttons = tabs.map((tab, index) => {
        const el = button(
          tab.title || codeLanguage(tab.language || 'text')?.name || tab.language,
          tab.title || codeLanguage(tab.language || 'text')?.name || tab.language,
          () => this.select(index),
        );
        el.setAttribute('role', 'tab');
        el.setAttribute('aria-controls', this.pages.id);
        el.setAttribute('aria-selected', String(index === this.active));
        el.tabIndex = index === this.active ? 0 : -1;
        el.addEventListener('keydown', event => {
          const next = event.key === 'ArrowRight'
            ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft'
            ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home'
            ? 0
            : event.key === 'End'
            ? tabs.length - 1
            : -1;
          if (next >= 0) {
            event.preventDefault();
            this.select(next);
            this.bar.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus();
          }
        });
        return el;
      });
      const add = button('新建代码标签页', '+', () => {
        const source = createCodeTab(this.node.textContent);
        this.changeSource(source, parseCodeTabs(source).length - 1);
        this.setManagement(true,!this.dom.closest('.mobile-app'));
      });
      const edit = button('管理代码标签页', '⋯', () => {
        this.setManagement(this.manage.hidden,!this.dom.closest('.mobile-app'));
      });
      this.manageButton=edit;
      edit.setAttribute('aria-controls',this.manage.id);
      edit.setAttribute('aria-expanded',String(!this.manage.hidden));
      edit.setAttribute('aria-pressed',String(!this.manage.hidden));
      add.disabled = !this.view.editable;
      edit.disabled = !tabs.length;
      this.bar.replaceChildren(...buttons, add, edit);
    }
    const active = tabs[this.active];
    this.pages.setAttribute(
      'aria-label',
      active?.title || codeLanguage(active?.language || 'text')?.name || active?.language || '代码',
    );
    this.language.value = active?.language || '';
    this.title.value = active?.title || '';
    this.language.disabled = this.title.disabled = !this.view.editable || !active
      || active.declarationFrom === null;
    const moves = this.manage.querySelectorAll<HTMLButtonElement>('button');
    moves[0].disabled = !this.view.editable || !active || active.declarationFrom === null
      || this.active === 0 || tabs[this.active - 1]?.declarationFrom === null;
    moves[1].disabled = !this.view.editable || !active || active.declarationFrom === null
      || this.active === tabs.length - 1;
    moves[2].disabled = !this.view.editable || !active || active.declarationFrom === null;
    if (this.sourceMode || !tabs.length) this.setManagement(false);
    this.pages.hidden = !this.sourceMode && !active;
    this.cm.dom.dataset.codeSourceOffset = String(this.offset());
    const text = this.sourceMode ? this.node.textContent : active?.code || '',
      old = this.cm.state.doc.toString();
    if (text !== old) {
      let from = 0, tail = 0;
      while (from < old.length && from < text.length && old[from] === text[from]) from++;
      while (
        tail < old.length - from && tail < text.length - from
        && old[old.length - 1 - tail] === text[text.length - 1 - tail]
      ) tail++;
      this.syncing = true;
      try {
        this.cm.dispatch({
          changes: { from, to: old.length - tail, insert: text.slice(from, text.length - tail) },
        });
      } finally {
        this.syncing = false;
      }
    }
    const language = this.sourceMode ? 'tabs' : active?.language || 'text';
    if (language !== this.loadedLanguage) {
      this.loadedLanguage = language;
      const revision = ++this.languageRevision;
      this.cm.dispatch({ effects: this.languageConf.reconfigure([]) });
      void codeLanguage(language)?.load().then(support => {
        if (!this.destroyed && revision === this.languageRevision) {
          this.cm.dispatch({ effects: this.languageConf.reconfigure(support) });
        }
      }).catch(console.error);
    }
    this.renderPreview(language, text);
  }
  private renderPreview(language: string, text: string) {
    const key = JSON.stringify([language.toLowerCase(), text, this.node.attrs.meta]);
    if (key === this.previewKey) return;
    this.previewKey = key;
    const revision = ++this.previewRevision;
    clearTimeout(this.previewTimer);
    this.preview.replaceChildren();
    this.preview.hidden = true;
    delete this.preview.dataset.previewLoading;
    if (this.sourceMode || !['mermaid', 'latex', 'math'].includes(language.toLowerCase())) return;
    this.preview.hidden = false;
    this.preview.textContent = '正在加载…';
    this.preview.dataset.previewLoading = 'true';
    this.previewTimer = setTimeout(() => {
      void codeTabPreview(language, text, this.node.attrs.meta || '').then(result => {
        if (!this.destroyed && revision === this.previewRevision && result) {
          this.preview.replaceChildren(result);
          this.preview.hidden = false;
          delete this.preview.dataset.previewLoading;
        }
      }).catch(console.error);
    }, 180);
  }
  update(node: Node) {
    if (node.type !== this.node.type || !isTabbedCode(node.attrs.language || '')) return false;
    const changed = node.textContent !== this.node.textContent,
      metaChanged = node.attrs.meta !== this.node.attrs.meta;
    this.node = node;
    if (metaChanged) {
      const height = heightFromMeta(node.attrs.meta || '');
      this.frame.style.height = height ? height + 'px' : '';
    }
    if (changed) {
      const pos = this.getPos();
      if (
        !this.sourceMode && pos !== undefined
        && this.view.state.selection.$head.parent.type.name === 'code_block'
      ) {
        this.active = tabAtOffset(
          this.tabs(),
          this.view.state.selection.head - pos - 1,
          this.active,
        );
      }
      if (this.syncing) {
        if (!this.renderQueued) {
          this.renderQueued = true;
          queueMicrotask(() => {
            this.renderQueued = false;
            if (!this.destroyed) {
              const focused = this.cm.hasFocus;
              this.render();
              const pos = this.getPos(), selection = this.view.state.selection;
              if (
                focused && pos !== undefined && selection.from >= pos + 1
                && selection.to <= pos + this.node.nodeSize - 1
              ) {
                this.setSelection(selection.anchor - pos - 1, selection.head - pos - 1);
              }
            }
          });
        }
      } else {
        this.render();
        // History and outer document commands own their PM selection. The
        // code view can retain focus, so PM will not necessarily call its
        // setSelection hook after replacing the text. Synchronize without
        // requesting focus or borrowing an old page-local caret.
        const pos=this.getPos(),selection=this.view.state.selection;
        if(pos!==undefined&&selection.$head.parent===node&&selection.$anchor.parent===node)
          this.syncSelection(selection.anchor-pos-1,selection.head-pos-1);
      }
    } else if (metaChanged) this.renderPreview(this.loadedLanguage, this.cm.state.doc.toString());
    return true;
  }
  setSelection(anchor: number, head: number) {
    if (this.syncing || this.destroyed) return;
    this.syncSelection(anchor, head);
    if (!this.cm.hasFocus && mayFocusSelection(this.view, 'node-update')) this.cm.focus();
  }
  private syncSelection(anchor: number, head: number) {
    const tabs = this.tabs();
    if (
      !this.sourceMode
      && tabAtOffset(tabs, anchor, this.active) !== tabAtOffset(tabs, head, this.active)
    ) {
      this.setMode(true, false);
    }
    if (!this.sourceMode) {
      const index = tabAtOffset(tabs, head, this.active);
      if (index !== this.active) {
        this.remember();
        this.active = index;
        this.render();
      }
    }
    this.setCodeSelection(anchor - this.offset(), head - this.offset());
  }
  focusSelection(anchor: number, head: number, intent: FocusIntent) {
    if (this.syncing || this.destroyed) return;
    // With no pages, the tabs view has no visible editing surface. History can
    // still restore a text selection here, so expose its source before focus.
    if(!this.sourceMode&&!this.tabs().length)this.setMode(true,false);
    this.syncSelection(anchor, head);
    if (mayFocusSelection(this.view, intent)) this.cm.focus();
  }
  selectNode() {
    this.dom.classList.add('selected');
  }
  deselectNode() {
    this.dom.classList.remove('selected');
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.destroyed = true;
    clearTimeout(this.previewTimer);
    this.dom.removeEventListener('moyu-tabs-display', this.restoreMode);
    this.cm.destroy();
  }
}

export const tabbedCodeView = $view(codeBlockSchema.node, ctx => {
  const config = ctx.get(codeBlockConfig.key);
  const loader = {
    load: (name: string) => codeLanguage(name)?.load() || Promise.resolve(undefined),
    getAll: () =>
      config.languages.map(language => ({ name: language.name, alias: language.alias })),
  } as unknown as ConstructorParameters<typeof CodeMirrorBlock>[3];
  return (node, view, getPos) => {
    if (isTabbedCode(node.attrs.language || '')) {
      const block = new TabbedCodeView(node, view, getPos, config);
      const destroy = block.destroy.bind(block);
      const release = registerCodeFocus(block.dom, (anchor, head, intent) => block.focusSelection(anchor, head, intent));
      block.destroy = () => { release(); destroy(); };
      return block;
    }
    const block = new CodeMirrorBlock(node, view, getPos, loader, config),
      update = block.update.bind(block);
    const cleanupLanguage=codeLanguageMenu(block,config.languages),destroy=block.destroy.bind(block);
    block.destroy=()=>{cleanupLanguage();destroy();};
    block.update = next => !isTabbedCode(next.attrs.language || '') && update(next);
    return codeBlockSelection(block);
  };
});
