import type { Plugin } from 'unified';
import type { Handler } from 'mdast-util-to-hast';
import type { Root } from 'mdast';
declare const remarkFoldingQuotes: Plugin<[], Root>;
export default remarkFoldingQuotes;
export const foldingQuoteHTML: Handler;
