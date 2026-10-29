// An Android IME can close while its editable element keeps focus. Drop that
// stale focus only for an explicit control gesture, never for a transient IME
// visibility change (for example switching keyboards during composition).
export function keepClosedKeyboard(control:HTMLElement){
  const doc=control.ownerDocument;
  if(!control.closest('.mobile-app')||doc.documentElement.dataset.mobileKeyboard!=='false')return;
  const active=doc.activeElement;
  if(active instanceof HTMLElement&&active.closest('.mobile-document')&&(active.isContentEditable||active.matches('input,textarea')))active.blur();
}

/** Code controls change presentation or metadata; they do not start typing. */
export function keepCodeControlFocus(control:HTMLElement,event:{preventDefault():void;stopPropagation():void}){
  keepClosedKeyboard(control);event.preventDefault();event.stopPropagation();
}
