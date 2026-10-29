export function viewerPages(value:unknown):[string,number][];
export function rememberViewerPage(value:unknown,key:string,page:number):[string,number][];
export interface AttachmentView {
  height?:number;pdfPage?:number;pdfRotation?:number;pdfZoom?:number|'automatic'|'fit-page'|'fit-width';pdfSpread?:'none'|'odd'|'even';pdfScroll?:'vertical'|'horizontal';pdfPan?:boolean;
  pdfSidebar?:{placement:string;slot:string;id:string;open:boolean;tab?:string};
  scoreZoom?:number;scoreLayout?:'page'|'horizontal';scoreTrack?:number|'all';scoreSpeed?:number;scoreVolume?:number;scoreLoop?:boolean;scoreMetronome?:boolean;scorePosition?:number;
  imageWindowWidth?:number;imageWindowHeight?:number;imageZoom?:number|'fit';imageRotation?:number;
}
export function attachmentView(value:unknown):AttachmentView;
export function attachmentViews(value:unknown):Record<string,AttachmentView>;
