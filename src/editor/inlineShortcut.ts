// Keep the same format shortcuts in preview editing and source editing.
export function inlineShortcut(event: Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return;
  const key=event.key.toLowerCase();
  if (event.altKey) return key==='x' ? 'strike' : undefined;
  return key==='b' ? 'bold' : key==='i' ? 'italic' : undefined;
}
