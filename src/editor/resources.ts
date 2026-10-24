import { indentConfig } from '@milkdown/kit/plugin/indent';
import { joinBackward, joinForward } from '@milkdown/kit/prose/commands';
import { Fragment } from '@milkdown/kit/prose/model';
import { EditorState, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { canSplit } from '@milkdown/kit/prose/transform';
import { $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils';
import katex from 'katex';
import remarkHighlight from '../../shared/remark-highlight.mjs';
import remarkUnderline from '../../shared/remark-underline.mjs';
import { applyAttachmentSize, attachmentSize } from '../attachmentLayout';
import { attachmentMarkdown, isAttachmentLink } from '../attachmentLinks';
import {
  type InlineAst,
  inlineLinkAt,
  parseInline,
  sourceInlineTree,
} from '../inlineSyntax';
import { drawingSvg, isPreviewResource, resourcePath,resourceImageURL } from '../resourcePreview';
import { createAttachmentPreview } from './attachmentPreview';
import { htmlInlineMarkdown } from './htmlInline';
import { separateInlineText } from './inlineSourceEditing';
import { inlineInputTransaction } from './inlineInput';
import { foldingInput, leaveFoldHeading, unfoldAtStart } from './foldingQuoteEditing';
import { indentText } from './textIndentation';
import { readNativeSelection, syncInlineCaret } from './nativeSelection';

// Keep the whole outer inline region as standard Markdown. Nested emphasis,
// links and formulas share one editable source instead of invisible PM marks.
export const resourceSources = $remark(
  'moyuInlineSources',
  () => function(this: any) {
    remarkHighlight.call(this);
    remarkUnderline.call(this);
    return (tree: InlineAst, file: {value: unknown}) => sourceInlineTree(tree, String(file.value));
  },
);
export const resourceSchema = $nodeSchema('resource_link', () => ({
  inline: true,
  group: 'inline',
  content: 'text*',
  marks: '',
  code: true,
  selectable: false,
  parseDOM: [
    { tag: 'span[data-inline-source]', contentElement: '.syntax-raw' },
    ...['strong', 'b', 'em', 'i', 's', 'del', 'code', 'mark', 'u'].map(tag => ({
      tag,
      priority: 100,
      getContent: (dom: globalThis.Node, schema: import('@milkdown/kit/prose/model').Schema) =>
        Fragment.from(schema.text(htmlInlineMarkdown(dom))),
    })),
    {
      tag: 'img[src]',
      priority: 100,
      getContent: (dom, schema) =>
        Fragment.from(
          schema.text(
            attachmentMarkdown({
              type: 'image',
              url: (dom as HTMLImageElement).getAttribute('src') || '',
              alt: (dom as HTMLImageElement).alt,
              title: (dom as HTMLImageElement).title,
            }),
          ),
        ),
    },
    {
      tag: 'a[href]',
      priority: 100,
      getContent: (dom, schema) => Fragment.from(schema.text(htmlInlineMarkdown(dom))),
    },
  ],
  toDOM: () => ['span', { 'data-inline-source': 'true' }, ['span', { class: 'syntax-raw' }, 0]],
  parseMarkdown: {
    match: node => node.type === 'inlineSource',
    runner(state, node, type) {
      state.openNode(type);
      if (node.value) state.addText(String(node.value));
      state.closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'resource_link',
    runner(state, node) {
      if (node.textContent) state.addNode('inlineRaw', undefined, node.textContent);
    },
  },
}));
export const resourceInput = $prose(() =>
  new Plugin({props:{
    handleTextInput(view,from,to,text){
      const tr=foldingInput(view.state,from,to,text) || inlineInputTransaction(view.state,from,to,text);
      if (!tr) return false;
      view.dispatch(tr.scrollIntoView());return true;
    },
    handleDOMEvents:{compositionend(view){
      setTimeout(()=>{
        if (view.isDestroyed || view.composing || !view.state.selection.empty) return;
        const pos=view.state.selection.head,tr=inlineInputTransaction(view.state,pos,pos,'');
        if (tr) view.dispatch(tr);
      });
      return false;
    }},
  }})
);

export const resourceKeys = $prose(ctx =>
  new Plugin({
    view: view => {
      const settle=()=>readNativeSelection(view);
      view.dom.addEventListener('moyu-attachment-selection-settle',settle);
      return {update:(_view,previous)=>{
        if(!previous.selection.eq(view.state.selection)||previous.doc!==view.state.doc)
          view.dom.dispatchEvent(new Event('moyu-inline-selection'));
      },destroy(){view.dom.removeEventListener('moyu-attachment-selection-settle',settle);}};
    },
    appendTransaction(transactions, old, state) {
      const editing = state.selection.$head.parent;
      const leavingSource = old.selection.$head.parent.type.name === 'resource_link'
        && old.selection.$head.parent !== editing;
      if (!transactions.some(tr => tr.docChanged) && !leavingSource) return null;
      const separated = separateInlineText(
        state,
        editing.type.name === 'resource_link' ? editing : undefined,
      );
      if (separated) return separated;
      const empty: number[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'resource_link' && !node.content.size) empty.push(pos);
      });
      if (!empty.length) return null;
      const tr = state.tr;
      for (const pos of empty.reverse()) tr.delete(pos, pos + 2);
      return tr;
    },
    props: {
      handleDOMEvents: {
        beforeinput(view, event) {
          if (view.composing || event.isComposing) return false;
          readNativeSelection(view);
          if (
            event.inputType === 'deleteContentBackward'
            || event.inputType === 'deleteContentForward'
          ) {
            if (event.inputType === 'deleteContentBackward' && unfoldAtStart(view.state, view.dispatch)) {
              event.preventDefault();return true;
            }
            if (deleteInlineCharacter(view, event.inputType === 'deleteContentBackward')) {
              event.preventDefault();
              return true;
            }
            return false;
          }
          if (event.inputType !== 'insertText' || !event.data) return false;
          const selection = view.state.selection, head = selection.$head;
          // At an inline container's outer boundary Chromium can insert into its
          // child text instead. Keep adjacent typing in the surrounding paragraph.
          if (
            head.parent.type.name === 'resource_link'
            || selection.empty && head.parent.inlineContent
              && (head.nodeBefore?.type.name === 'resource_link'
                || head.nodeAfter?.type.name === 'resource_link')
          ) {
            event.preventDefault();
            let from = selection.from, to = selection.to;
            if (
              selection.empty && head.parent.type.name === 'resource_link'
              && parseInline(head.parent.textContent)?.decorated
            ) {
              if (head.parentOffset === 0) from = to = head.before();
              else if (head.parentOffset === head.parent.content.size) from = to = head.after();
              if (from !== selection.from) {
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.create(view.state.doc, from)),
                );
                // Leaving a draft can split it into several source/text nodes.
                // Append transactions map the selection; use that new position
                // instead of inserting at the old container's boundary.
                from = view.state.selection.from;
                to = view.state.selection.to;
              }
            }
            // Boundary typing must pass through the normal input rules. This
            // lets "- " / "1. " create a list while leaving the link intact.
            if (
              !view.someProp('handleTextInput', handler =>
                handler(
                  view,
                  from,
                  to,
                  event.data!,
                  () => view.state.tr.insertText(event.data!, from, to),
                ))
            ) {
              view.dispatch(view.state.tr.insertText(event.data, from, to).scrollIntoView());
            }
            return true;
          }
          return false;
        },
        keydown(view, event) {
          if (
            view.composing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
          ) return false;
          if (
            [
              'Home',
              'End',
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
              'Escape',
              'Tab',
              'Backspace',
              'Delete',
              'Enter',
            ].includes(event.key)
          ) {
            readNativeSelection(view);
          }
          if (event.key === 'Backspace' && unfoldAtStart(view.state, view.dispatch)) {
            event.preventDefault();return true;
          }
          if (event.key === 'ArrowLeft' && !event.shiftKey && leaveFoldHeading(view.state, view.dispatch)) {
            event.preventDefault();return true;
          }
          if (
            ['Backspace', 'Delete'].includes(event.key)
            && deleteInlineCharacter(view, event.key === 'Backspace')
          ) {
            event.preventDefault();
            return true;
          }
          const { selection } = view.state, { $head } = selection;
          if (event.key === 'Tab') {
            if (!(event.target as Element).closest('.cm-editor')
              && indentText(view.state, view.dispatch, event.shiftKey, ctx.get(indentConfig.key).size)) {
              event.preventDefault();
              syncInlineCaret(view);
              return true;
            }
          }
          let pos: number | undefined, boundary: 'before' | 'after' | undefined;
          if (
            selection.empty && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)
            && !['code_block', 'resource_link'].includes($head.parent.type.name)
            && view.endOfTextblock(event.key === 'ArrowDown' ? 'down' : 'up')
          ) {
            // A preview spacer is deliberately not editable. Chromium skips such
            // a line; navigate to its source instead of letting the image swallow it.
            const down = event.key === 'ArrowDown', current = $head.before();
            let adjacent:
              | { node: import('@milkdown/kit/prose/model').Node; pos: number }
              | undefined;
            view.state.doc.descendants((node, p) => {
              if (!node.isTextblock) return;
              if (down && p > current && !adjacent || !down && p < current) {
                adjacent = { node, pos: p };
              }
              return false;
            });
            const first = adjacent?.node.firstChild;
            if (
              first?.type.name === 'resource_link'
              && parseInline(first.textContent)?.nodes.some(n =>
                n.type === 'image' || isPreviewResource(n.url || '')
              )
            ) {
              pos = adjacent!.pos + 2;
            }
          }
          if (
            event.key === 'Enter' && !event.shiftKey && selection.empty
            && $head.parent.type.name === 'resource_link'
          ) {
            if ($head.parentOffset === 0 || $head.parentOffset === $head.parent.content.size) {
              // Let normal paragraph/list commands handle Enter outside the inline
              // container; otherwise Chromium inserts a break inside its source DOM.
              const before = $head.parentOffset === 0, dom = view.nodeDOM($head.before());
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, before ? $head.before() : $head.after()),
                ),
              );
              if (dom?.parentNode) {
                const range = document.createRange();
                before ? range.setStartBefore(dom) : range.setStartAfter(dom);
                range.collapse(true);
                const native = document.getSelection();
                native?.removeAllRanges();
                native?.addRange(range);
              }
              return false;
            }
            if (canSplit(view.state.doc, $head.pos, 2)) {
              event.preventDefault();
              const tr = view.state.tr.split($head.pos, 2);
              view.dispatch(
                tr.setSelection(TextSelection.create(tr.doc, $head.pos + 4)).scrollIntoView(),
              );
              return true;
            }
          }
          if ($head.parent.type.name === 'resource_link') {
            if (
              !selection.empty && !event.shiftKey
              && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            ) pos = event.key === 'ArrowLeft' ? selection.from : selection.to;
            else if (event.key === 'Home') pos = $head.start();
            else if (event.key === 'End') pos = $head.end();
            else if (event.key === 'ArrowLeft' && $head.parentOffset === 0) {
              pos = $head.before();
              boundary = 'before';
            } else if (
              event.key === 'ArrowRight' && $head.parentOffset === $head.parent.content.size
            ) {
              pos = $head.after();
              boundary = 'after';
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              const offsets = [
                ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
                  $head.parent.textContent,
                ),
              ].map(s => s.index);
              offsets.push($head.parent.content.size);
              const offset = event.key === 'ArrowLeft'
                ? [...offsets].reverse().find(i => i < $head.parentOffset)
                : offsets.find(i => i > $head.parentOffset);
              if (offset !== undefined) pos = $head.start() + offset;
            } else if (event.key === 'Escape') {
              pos = $head.after();
              boundary = 'after';
            }
          } else if (selection.empty) {
            if (event.key === 'ArrowRight' && $head.nodeAfter?.type.name === 'resource_link') {
              pos = $head.pos + 1;
            } else if (
              event.key === 'ArrowLeft' && $head.nodeBefore?.type.name === 'resource_link'
            ) pos = $head.pos - 1;
            else if (
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
              && $head.parent.inlineContent
              && Array.from({ length: $head.parent.childCount }, (_, i) => $head.parent.child(i))
                .some(n => n.type.name === 'resource_link')
            ) {
              const text = event.key === 'ArrowLeft' ? $head.nodeBefore : $head.nodeAfter;
              if (text?.isText) {
                const offset = event.key === 'ArrowLeft' ? text.text!.length : 0,
                  next = characterOffset(text.text!, offset, event.key === 'ArrowLeft');
                pos = $head.pos + (next - offset);
              }
            }
          }
          if (pos === undefined) return false;
          event.preventDefault();
          const dom = boundary ? view.nodeDOM($head.before()) : null;
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, event.shiftKey ? selection.anchor : pos, pos),
            ),
          );
          if (!event.shiftKey) syncInlineCaret(view);
          if (boundary && dom?.parentNode && !event.shiftKey) {
            const range = view.dom.ownerDocument.createRange();
            boundary === 'after' ? range.setStartAfter(dom) : range.setStartBefore(dom);
            range.collapse(true);
            const native = view.dom.ownerDocument.getSelection();
            native?.removeAllRanges();
            native?.addRange(range);
          }
          return true;
        },
      },
    },
  })
);

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function characterOffset(text: string, offset: number, backward: boolean) {
  const segment = graphemes.segment(text).containing(backward ? offset - 1 : offset);
  return segment ? backward ? segment.index : segment.index + segment.segment.length : offset;
}
function inlineDeletionPosition(
  doc: import('@milkdown/kit/prose/model').Node,
  pos: number,
  backward: boolean,
) {
  const at = doc.resolve(pos), adjacent = backward ? at.nodeBefore : at.nodeAfter;
  return adjacent?.type.name === 'resource_link'
    ? pos + (backward ? -1 : 1)
    : at.nodeAfter?.type.name === 'resource_link'
    ? pos + 1
    : at.nodeBefore?.type.name === 'resource_link'
    ? pos - 1
    : pos;
}
function deleteInlineCharacter(
  view: import('@milkdown/kit/prose/view').EditorView,
  backward: boolean,
) {
  const s = view.state.selection, h = s.$head;
  if (!s.empty) return false;
  let from: number | undefined, to: number | undefined;
  if (h.parent.type.name === 'resource_link') {
    const next = characterOffset(h.parent.textContent, h.parentOffset, backward);
    if (next !== h.parentOffset) {
      from = h.start() + Math.min(next, h.parentOffset);
      to = h.start() + Math.max(next, h.parentOffset);
    } else {
      const edge = backward ? h.before() : h.after(),
        outside = view.state.doc.resolve(edge),
        text = backward ? outside.nodeBefore : outside.nodeAfter;
      if (text?.isText) {
        const offset = backward ? text.text!.length : 0,
          next = characterOffset(text.text!, offset, backward);
        from = edge + Math.min(0, next - offset);
        to = edge + Math.max(0, next - offset);
      } else if (
        outside.parent.isTextblock && (backward
          ? outside.parentOffset === 0
          : outside.parentOffset === outside.parent.content.size)
      ) {
        // Paragraph joins belong to the paragraph, not the nested inline source.
        // Joining at the source's own boundary can make PM remove that container.
        const state = EditorState.create({
          doc: view.state.doc,
          selection: TextSelection.create(view.state.doc, edge),
        });
        return (backward ? joinBackward : joinForward)(state, tr => {
          const head = inlineDeletionPosition(tr.doc, tr.selection.head, backward);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, head)).scrollIntoView());
          view.focus();
          syncInlineCaret(view);
        });
      }
    }
  } else {
    const node = backward ? h.nodeBefore : h.nodeAfter;
    if (node?.type.name === 'resource_link' && node.content.size) {
      const edge = backward ? h.pos - 1 : h.pos + 1,
        offset = backward ? node.content.size : 0,
        next = characterOffset(node.textContent, offset, backward);
      from = edge + Math.min(0, next - offset);
      to = edge + Math.max(0, next - offset);
    } else if (node?.isText) {
      const edge = view.state.doc.resolve(h.pos + (backward ? -node.nodeSize : node.nodeSize)),
        adjacent = backward ? edge.nodeBefore : edge.nodeAfter;
      // Own the last adjacent character as well as the source itself. Native
      // deletion otherwise parks the caret at a hidden preview boundary, or
      // Chromium resolves it to the wrong end after the preview folds.
      if (adjacent?.type.name === 'resource_link') {
        const offset = backward ? node.text!.length : 0,
          next = characterOffset(node.text!, offset, backward),
          distance = next - offset;
        if (Math.abs(distance) === node.nodeSize) {
          from = h.pos + Math.min(0, distance);
          to = h.pos + Math.max(0, distance);
        }
      }
    }
  }
  if (from === undefined || to === undefined || from === to) return false;
  const tr = view.state.tr.delete(from, to);
  view.dispatch(
    tr.setSelection(TextSelection.create(tr.doc, inlineDeletionPosition(tr.doc, from, backward)))
      .scrollIntoView(),
  );
  syncInlineCaret(view);
  return true;
}

export const resourceView = (path: string) =>
  $view(resourceSchema.node, () => (node, view, getPos) => {
    const dom = document.createElement('span');
    dom.className = 'inline-syntax';
    dom.dataset.inlineSource = 'true';
    const preview = document.createElement('span');
    preview.className = 'syntax-preview';
    preview.contentEditable = 'false';
    const contentDOM = document.createElement('span');
    contentDOM.className = 'syntax-raw';
    dom.append(contentDOM, preview);
    const media = createAttachmentPreview(dom, preview, view.dom, () => {
      const pos = getPos();
      if (pos === undefined || view.isDestroyed) return;
      const selection = TextSelection.create(
        view.state.doc,
        pos + 1,
        pos + 1,
      );
      if (!view.state.selection.eq(selection)) view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
      sync();
    });
    let generation = 0,
      lastRaw = '',
      valid = false,
      visualKey = '',
      visualAlt = '',
      visualRevision = 0;
    const paths = new Set<string>();
    const sync = () => {
      const pos = getPos(), s = view.state.selection;
      const editing = !valid
        || pos !== undefined && (media.external
            ? s.from < pos + node.nodeSize && s.to > pos
            : s.from <= pos + node.nodeSize && s.to >= pos);
      dom.classList.toggle('editing', media.setEditing(editing));
    };
    const render = (force = false) => {
      if (!force && lastRaw === node.textContent) {
        sync();
        return;
      }
      lastRaw = node.textContent;
      const current = ++generation, parsed = parseInline(lastRaw);
      valid = !!parsed?.decorated;
      paths.clear();
      dom.dataset.syntaxRaw = lastRaw;
      dom.dataset.syntax = parsed?.kind || 'text';
      dom.classList.toggle('inline-math', parsed?.kind === 'inlineMath');
      contentDOM.classList.toggle('math-raw', parsed?.kind === 'inlineMath');
      preview.classList.toggle('math-render', parsed?.kind === 'inlineMath');
      const single = parsed?.nodes.length === 1 ? parsed.nodes[0] : null,
        attachment = single && isAttachmentLink(single);
      const visual = (ast: InlineAst): boolean =>
        ast.type === 'image' || isPreviewResource(ast.url || '') || !!ast.children?.some(visual);
      const hasVisual = !!parsed?.nodes.some(visual);
      dom.classList.toggle('visual-attachment', hasVisual);
      media.setVisual(hasVisual);
      dom.classList.toggle('attachment-link', !!attachment);
      dom.dataset.resourceRaw = attachment ? lastRaw : '';
      dom.dataset.resourceLink = attachment ? single.url || '' : '';
      dom.dataset.resourceLabel = attachment
        ? (single.alt || single.children?.map(n => n.value || '').join('') || '')
        : '';
      dom.dataset.resourcePath = attachment ? resourcePath(path, single.url || '') : '';
      preview.className = 'syntax-preview' + (media.external ? ' attachment-overlay' : '')
        + (attachment ? ' attachment-preview' : '')
        + (parsed?.kind === 'inlineMath' ? ' math-render' : '');
      contentDOM.classList.toggle('attachment-raw', !!attachment);
      preview.dataset.resourceLink = dom.dataset.resourceLink;
      preview.dataset.resourceLabel = dom.dataset.resourceLabel;
      preview.dataset.resourceRaw = dom.dataset.resourceRaw;
      preview.dataset.resourcePath = dom.dataset.resourcePath;
      const resourceData = (element: HTMLElement, ast: InlineAst) => {
        element.dataset.linkOffset = String(ast.position?.start.offset || 0);
        element.dataset.resourceLink = ast.url || '';
        element.dataset.resourceLabel = ast.alt || ast.children?.map(n => n.value || '').join('')
          || '';
        element.dataset.resourceImage = String(ast.type === 'image');
        element.dataset.resourceRaw = lastRaw.slice(
          ast.position?.start.offset,
          ast.position?.end.offset,
        );
      };
      const key = single && (single.type === 'image' || isPreviewResource(single.url || ''))
        ? JSON.stringify([single.type, single.url])
        : '';
      visualAlt = single?.alt || single?.children?.map(n => n.value || '').join('') || '';
      if (key && key === visualKey && !force) {
        const image = preview.querySelector('img'),
          svg = preview.querySelector('svg'),
          link = preview.querySelector('.resource-preview');
        if (image || link) resourceData((image || link) as HTMLElement, single!);
        if (image) {
          const resolved=resourcePath(path,single!.url||'');if(resolved)paths.add(resolved);
          image.alt = attachmentSize(visualAlt).label;
          applyAttachmentSize(image, visualAlt, image.naturalWidth);
        }
        if (svg) {
          applyAttachmentSize(
            svg,
            visualAlt,
            Number((svg.getAttribute('viewBox') || '').split(/[ ,]+/)[2]) || 400,
          );
        }
        if (link) {
          paths.add(resourcePath(path, single!.url || ''));
          if (!svg) link.textContent = attachmentSize(visualAlt).label || '绘图';
        }
        if (single!.type === 'image') preview.classList.add('attachment-image');
        sync();
        return;
      }
      visualKey = key;
      const mediaRevision = ++visualRevision;
      preview.replaceChildren();
      const paint = (ast: InlineAst, parent: HTMLElement) => {
        if (['link', 'image'].includes(ast.type) && isPreviewResource(ast.url || '')) {
          const resolved = resourcePath(path, ast.url || ''), link = document.createElement('a');
          link.className = 'resource-preview';
          resourceData(link, ast);
          link.dataset.linkOffset = String(ast.position?.start.offset || 0);
          link.setAttribute('href', ast.url || '');
          link.textContent = attachmentSize(
            ast.alt || ast.children?.map(n => n.value || '').join('') || '绘图',
          ).label;
          link.dataset.previewLoading = 'true';
          parent.append(link);
          paths.add(resolved);
          void drawingSvg(resolved).then(svg => {
            if (ast === single ? mediaRevision !== visualRevision : current !== generation) return;
            const width = Number((svg.getAttribute('viewBox') || '').split(/[ ,]+/)[2]) || 400;
            applyAttachmentSize(svg, ast === single ? visualAlt : ast.alt || '', width);
            link.replaceChildren(svg);
          }).catch(() => {}).finally(() => {
            delete link.dataset.previewLoading;
            media.schedule();
          });
          return;
        }
        if (ast.type === 'text') {
          const text = document.createElement('span');
          text.textContent = ast.value || '';
          text.dataset.sourceOffset = String(ast.position?.start.offset || 0);
          parent.append(text);
          return;
        }
        if (ast.type === 'inlineMath') {
          const math = document.createElement('span');
          math.dataset.sourceOffset = String((ast.position?.start.offset || 0) + 1);
          katex.render(ast.value || '', math, { throwOnError: false });
          parent.append(math);
          return;
        }
        if (ast.type === 'image') {
          const image = document.createElement('img');
          resourceData(image, ast);
          image.draggable = false;
          image.dataset.previewLoading = 'true';
          const resolved=resourcePath(path,ast.url||'');if(resolved)paths.add(resolved);
          image.src = resourceImageURL(path, ast.url || '');
          image.alt = attachmentSize(ast.alt || '').label;
          applyAttachmentSize(image, ast.alt || '', image.naturalWidth);
          image.addEventListener('load', () => {
            delete image.dataset.previewLoading;
            image.width = image.naturalWidth;
            image.height = image.naturalHeight;
            if (ast === single ? mediaRevision === visualRevision : current === generation) {
              applyAttachmentSize(
                image,
                ast === single ? visualAlt : ast.alt || '',
                image.naturalWidth,
              );
              media.schedule();
            }
          }, { once: true });
          image.addEventListener('error', () => {
            delete image.dataset.previewLoading;
            media.schedule();
          }, { once: true });
          image.dataset.linkOffset = String(ast.position?.start.offset || 0);
          parent.append(image);
          return;
        }
        if (ast.type === 'break') {
          parent.append(document.createElement('br'));
          return;
        }
        if (ast.type === 'html') {
          const comment = document.createElement('span');
          comment.className = 'markdown-comment';
          comment.textContent = ast.value || '';
          comment.dataset.sourceOffset = String(ast.position?.start.offset || 0);
          parent.append(comment);
          return;
        }
        const tags: Record<string, string> = {
            strong: 'strong',
            underline: 'u',
            emphasis: 'em',
            delete: 'del',
            highlight: 'mark',
            inlineCode: 'code',
            link: 'a',
          },
          element = document.createElement(tags[ast.type] || 'span');
        if (ast.type === 'inlineCode') {
          element.textContent = ast.value || '';
          element.dataset.sourceOffset = String(
            (ast.position?.start.offset || 0)
              + (lastRaw.slice(ast.position?.start.offset || 0).match(/^`+/)?.[0].length || 1),
          );
        }
        if (ast.type === 'link') {
          element.setAttribute('href', ast.url || '');
          element.dataset.linkOffset = String(ast.position?.start.offset || 0);
        }
        ast.children?.forEach(child => paint(child, element));
        parent.append(element);
      };
      parsed?.nodes.forEach(ast => paint(ast, preview));
      if (attachment && single.type === 'image') preview.classList.add('attachment-image');
      else if (attachment && !isPreviewResource(single.url || '')) {
        preview.classList.add('attachment-file');
      }
      sync();
    };
    const enter = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const pos = getPos();
      if (pos === undefined) return;
      if (event.ctrlKey || event.metaKey) {
        let offset = 0;
        const link = (event.target as Element).closest<HTMLElement>('[data-link-offset]');
        if (link) offset = Number(link.dataset.linkOffset);
        else if (contentDOM.contains(event.target as globalThis.Node)) {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          offset = Math.max(0, (at?.pos || pos + 1) - pos - 1);
        } else return;
        const value = inlineLinkAt(lastRaw, offset);
        if (value) {
          event.preventDefault();
          window.dispatchEvent(
            new CustomEvent('moyu-open-link', {
              detail: { href: value.href, wiki: value.wiki, document: path },
            }),
          );
        }
        return;
      }
      if (contentDOM.contains(event.target as globalThis.Node)) {
        const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
        if (caret && contentDOM.contains(caret.startContainer) && !event.shiftKey) {
          const position=view.posAtDOM(caret.startContainer,caret.startOffset);
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(
                view.state.doc,
                Math.max(pos+1,Math.min(position,pos+1+node.content.size)),
              ),
            ),
          );
          view.focus();
          return;
        }
        return;
      }
      if (!preview.contains(event.target as globalThis.Node)) return;
      if (media.external) return;
      event.preventDefault();
      let offset = 0;
      const leaf = (event.target as Element).closest<HTMLElement>('[data-source-offset]');
      if (leaf) {
        offset = Number(leaf.dataset.sourceOffset);
        const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
        if (caret && leaf.contains(caret.startContainer)) {
          const range = document.createRange();
          range.setStart(leaf, 0);
          range.setEnd(caret.startContainer, caret.startOffset);
          offset += range.toString().length;
        }
      }
      dom.classList.add('editing');
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pos + 1 + Math.min(offset, node.content.size)),
        ),
      );
      view.focus();
      sync();
    };
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string[]>).detail.some(path => paths.has(path)))render(true);
    };
    const themeChanged = () => {
      if ([...paths].some(isPreviewResource)) render(true);
    };
    const previewDown = (event: MouseEvent) => {
      if (media.external) enter(event);
    };
    // Prevent Chromium following the href after mousedown revealed its source.
    // Navigation is dispatched once by enter(), only with Ctrl/Meta held.
    const preventNavigation = (event: MouseEvent) => {
      if ((event.target as Element).closest('a')) event.preventDefault();
    };
    preview.addEventListener('mousedown', previewDown);
    preview.addEventListener('click', preventNavigation);
    dom.addEventListener('mousedown', enter);
    view.dom.addEventListener('moyu-inline-selection', sync);
    window.addEventListener('moyu-resources-changed', refresh);
    window.addEventListener('moyu-diagram-theme', themeChanged);
    render();
    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      ignoreMutation: mutation =>
        mutation.type === 'selection' ? false : !contentDOM.contains(mutation.target),
      stopEvent: event =>
        media.space.contains(event.target as globalThis.Node)
        || preview.contains(event.target as globalThis.Node)
        || event.type === 'mousedown'
          && (contentDOM.contains(event.target as globalThis.Node) || (event as MouseEvent).ctrlKey
            || (event as MouseEvent).metaKey),
      destroy() {
        generation++;
        visualRevision++;
        preview.removeEventListener('mousedown', previewDown);
        preview.removeEventListener('click', preventNavigation);
        media.destroy();
        dom.removeEventListener('mousedown', enter);
        view.dom.removeEventListener('moyu-inline-selection', sync);
        window.removeEventListener('moyu-resources-changed', refresh);
        window.removeEventListener('moyu-diagram-theme', themeChanged);
      },
    };
  });
