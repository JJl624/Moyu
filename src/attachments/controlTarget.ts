export const attachmentControlTarget=(target:EventTarget|null)=>target instanceof Element
  && !!target.closest('[data-attachment-control],.attachment-controls,embedpdf-container');
