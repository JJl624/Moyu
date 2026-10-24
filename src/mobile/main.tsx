import { androidBridge, nativeAvailable } from './native';
if (nativeAvailable()) window.moyu = androidBridge();
(window as unknown as {EXCALIDRAW_ASSET_PATH:string}).EXCALIDRAW_ASSET_PATH=new URL('./excalidraw/',document.baseURI).href;
// Initialize the transport before any module captures api.
await import('./mount');
