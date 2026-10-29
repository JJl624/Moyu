/** Synchronizing a logical range and acquiring the IME are separate operations. */
export type FocusIntent = 'edit' | 'node-update' | 'history' | 'restore';
export interface InputEnvironment {
  editable: boolean;
  composing: boolean;
  mobile: boolean;
  keyboardVisible: boolean;
  keyboardNavigation: boolean;
  deleting: boolean;
  outerFocused: boolean;
}

export function mayAcquireInput(intent: FocusIntent, input: InputEnvironment): boolean {
  if (!input.editable || input.composing) return false;
  if (!input.mobile) return true;
  if (intent === 'edit') return true;
  if (intent === 'history' || intent === 'restore') return input.keyboardVisible;
  return input.outerFocused && (input.keyboardNavigation || input.deleting);
}

export const isCodeBlock = (type: string) => type === 'code_block' || type === 'math_block';

export function clampCodeRange(anchor: number, head: number, length: number) {
  const clamp = (value: number) => Math.max(0, Math.min(length, value));
  return { anchor: clamp(anchor), head: clamp(head) };
}
