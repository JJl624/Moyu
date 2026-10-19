declare module 'moyu-excalidraw' {
  export const MoyuFonts:{register(id:number,family:string,bytes:ArrayBuffer):Promise<FontFace>;remove(id:number):void};
  export const MoyuLibrary:{setLoader(loader:()=>Promise<Blob>):void;open():Promise<Blob>};
  export {Excalidraw,MainMenu,exportToBlob,exportToSvg,serializeAsJSON,FONT_FAMILY,newElementWith,convertToExcalidrawElements,CaptureUpdateAction} from '@excalidraw/excalidraw';
}
