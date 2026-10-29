export const EMPTY_PARAGRAPH = '<br />';

/** The sole HTML marker that the document codec treats as an empty paragraph. */
export function isEmptyParagraphMarker(value) {
  return typeof value === 'string' && /^\s*<br\s*\/?\s*>\s*$/i.test(value);
}
