import { $remark } from '@milkdown/kit/utils';
import remarkMath from 'remark-math';

// Inline formulas use the shared source container, just like other inline
// Markdown. Display blocks are handled by displayMath.ts.
export const mathRemark = $remark('moyuMath', () => remarkMath);
