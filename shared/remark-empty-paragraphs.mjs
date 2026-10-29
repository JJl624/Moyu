import {isEmptyParagraphMarker} from './empty-paragraph.mjs';

/** Normalize the empty marker without enabling arbitrary HTML. */
export default function remarkEmptyParagraphs() {
  return tree => {
    const walk = (node, parent) => {
      if (node.type === 'html' && isEmptyParagraphMarker(node.value)) {
        if (parent?.type === 'paragraph' && parent.children.length === 1) parent.children = [];
        else if (['listItem', 'blockquote', 'root'].includes(parent?.type)) {
          node.type = 'paragraph';
          node.children = [];
          delete node.value;
        }
      }
      node.children?.forEach(child => walk(child, node));
    };
    walk(tree, null);
  };
}
