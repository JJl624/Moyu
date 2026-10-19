import { defaultHandlers, type Handle, type Handlers } from 'mdast-util-to-markdown';

export function inlineMarkdownHandlers(
  handlers?: Partial<Handlers> | null,
): Partial<Handlers> & { inlineRaw: Handle } {
  return {
    ...handlers,
    text(node, parent, state, info) {
      // Milkdown emits whitespace-only text verbatim. At a paragraph boundary,
      // indentation would then turn the following inline resource into code.
      const serialize = /^\s+$/.test(node.value)
        ? defaultHandlers.text
        : handlers?.text || defaultHandlers.text;
      return serialize(node, parent, state, info);
    },
    inlineRaw: node => (node as { value: string }).value,
  };
}
