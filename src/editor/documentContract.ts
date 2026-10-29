import type { Node } from '@milkdown/kit/prose/model';
import { isCodeBlock } from './selectionPolicy';

export class MarkdownStructureError extends Error {
  constructor() {
    super('Markdown 转换改变了文档结构，已保留当前编辑内容并停止保存。');
    this.name = 'MarkdownStructureError';
  }
}

// Generated labels, heading anchors and tight/loose layout are presentation.
// Block order, nesting, list starts, task state and exact code are persistent.
function blockStructure(node: Node): unknown {
  const type = node.type.name;
  if (isCodeBlock(type)) return [type, node.attrs.language || 'text', node.attrs.meta || '', node.textContent];
  const attributes = type === 'ordered_list' ? node.attrs.order ?? 1
    : type === 'list_item' ? node.attrs.checked ?? null
    : type === 'heading' ? node.attrs.level
    : type === 'blockquote' ? [node.attrs.folding ?? null, !!node.attrs.foldingDraft] : null;
  const children: unknown[] = [];
  if (!node.inlineContent) node.forEach(child => {
    // A root caret spacer is not persistent Markdown. A list/quote spacer is.
    if (type === 'doc' && child.type.name === 'paragraph' && !child.content.size) return;
    children.push(blockStructure(child));
  });
  return [type, attributes, children];
}

/** Validate fallback serialization; inline syntax is handled by its own codec. */
export function assertBlockRoundTrip(before: Node, after: Node) {
  if (JSON.stringify(blockStructure(before)) !== JSON.stringify(blockStructure(after))) {
    throw new MarkdownStructureError();
  }
}
