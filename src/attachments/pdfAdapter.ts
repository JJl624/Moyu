import type {EmbedPdfContainer, PDFViewerConfig} from '@embedpdf/snippet';
import type {ScrollCapability,ScrollStrategy} from '@embedpdf/plugin-scroll';
import type {UICapability} from '@embedpdf/plugin-ui';
import type {ZoomCapability,ZoomLevel} from '@embedpdf/plugin-zoom';
import type {SpreadCapability,SpreadMode} from '@embedpdf/plugin-spread';
import type {RotateCapability} from '@embedpdf/plugin-rotate';
import type {PanCapability} from '@embedpdf/plugin-pan';
import type {DocumentManagerCapability} from '@embedpdf/plugin-document-manager';
import type {ViewportCapability} from '@embedpdf/plugin-viewport';
import type {Rotation} from '@embedpdf/models';
import {type AttachmentViewState,reportAttachmentViewError} from './viewState';
import {attachmentViewKey,rememberedPage,rememberPage} from './preferences';
import {pdfDisabledCategories,pdfReaderMenus,pdfReaderToolbar} from './pdfReaderPolicy';

const base=()=>new URL('vendor/embedpdf/',document.baseURI).href;
let configuration: Promise<Pick<PDFViewerConfig,'wasmUrl'|'fontFallback'|'fonts'>> | undefined;
function config() {
  return configuration ||= fetch(base()+'fonts.json').then(async response=>{
    if(!response.ok)throw Error('PDF 字体资源不可用');
    return {wasmUrl:base()+'pdfium.wasm',fontFallback:{...await response.json(),baseUrl:base()},fonts:{ui:null,signature:null}};
  }).catch(error=>{configuration=undefined;throw error;});
}
export async function mountPdfViewer(host:HTMLElement,url:string,signal:AbortSignal,options:{path?:string;embedded?:boolean;state?:AttachmentViewState}={}) {
  const [module,assets]=await Promise.all([
    import(/* @vite-ignore */ base()+'embedpdf.js') as Promise<typeof import('@embedpdf/snippet')>,config(),
  ]);
  if(signal.aborted)return;
  // Apply the same feature policy to commands and their UI. A UI-only override
  // would otherwise bring disabled editing controls back into the reader.
  const disabled=pdfDisabledCategories(options.embedded);
  const saved=options.state?.get()||{};
  const viewer=module.default.init({type:'container',target:host,src:url,...assets,worker:true,
    theme:{preference:document.documentElement.dataset.theme==='dark'?'dark':'light'},tabBar:'never',
    i18n:{defaultLocale:'zh-CN'},disabledCategories:disabled,
    ui:{disabledCategories:[...disabled,'mode']},
    form:{withForms:false},permissions:{overrides:{modifyContents:false,modifyAnnotations:false,fillForms:false,assembleDocument:false}},
    // In 2.15.1 a numeric default never releases the initial zoom gate.
    // Start with an automatic layout, then restore the number through the API.
    zoom:{defaultZoomLevel:(typeof saved.pdfZoom==='number'?'automatic':saved.pdfZoom||'automatic') as ZoomLevel},spread:{defaultSpreadMode:(saved.pdfSpread||'none') as SpreadMode},rotation:{defaultRotation:(saved.pdfRotation||0) as Rotation},
    ...(saved.pdfPan!==undefined?{pan:{defaultMode:saved.pdfPan?'always' as const:'never' as const}}:{}),
    scroll:{defaultStrategy:(saved.pdfScroll||'vertical') as ScrollStrategy,...(options.embedded?{defaultPageGap:8,defaultBufferSize:1}:{})},
    ...(options.embedded?{viewport:{viewportGap:4}}:{}),
  });
  if(!viewer)throw Error('PDF 阅读器初始化失败');
  const theme=new MutationObserver(()=>viewer.setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light'));
  theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  let disposed=false;const subscriptions:Array<()=>void>=[];
  const dispose=()=>{disposed=true;for(const unsubscribe of subscriptions)unsubscribe();theme.disconnect();viewer.remove();void options.state?.flush().catch(reportAttachmentViewError);};
  signal.addEventListener('abort',dispose,{once:true});
  void viewer.registry.then(registry=>{
    if(disposed)return;
    let restored=false,initializing=true,applying=false,interacted=false,holdingPage=false,sidebar=saved.pdfSidebar,sidebarStamp='';
    // SDK initialization (including automatic touch pan mode) is not a user
    // preference change. Restore and responsive layout must remain read-only.
    // A command/restore owns its chosen page until another user gesture; layout
    // visibility is not a new page choice. No page-change event is needed to
    // release that ownership, even when restoring the already-current page.
    let cancelInitialRestore=()=>{};
    const interact=()=>{interacted=true;holdingPage=false;cancelInitialRestore();};
    for(const type of ['pointerdown','keydown','wheel'])host.addEventListener(type,interact,{capture:true,passive:true});
    subscriptions.push(()=>{for(const type of ['pointerdown','keydown','wheel'])host.removeEventListener(type,interact,true);});
    const changed=()=>restored&&!initializing&&interacted&&!applying&&host.isConnected&&host.clientWidth>0&&host.clientHeight>0;
    const manager=registry.getPlugin('document-manager')?.provides?.() as DocumentManagerCapability|undefined;
    const ui=registry.getPlugin('ui')?.provides?.() as UICapability|undefined;
    if(ui){
      const schema=ui.getSchema(),main=schema.toolbars['main-toolbar'];
      const toolbar=main?{...main,items:pdfReaderToolbar(main.items,options.embedded),...(options.embedded?{responsive:{breakpoints:{
        compact:{maxWidth:480,hide:['zoom-toolbar','pan-button','pointer-button','page-settings-button','sidebar-button','divider-3'],show:['zoom-menu-button','overflow-left-action-menu-button']},
        wide:{minWidth:480,show:['zoom-toolbar','pan-button','pointer-button','sidebar-button','page-settings-button','divider-3'],hide:['zoom-menu-button','overflow-left-action-menu-button']},
      }}}:{})}:undefined;
      ui.mergeSchema({menus:pdfReaderMenus(schema,[...disabled,'mode']),...(toolbar?{toolbars:{'main-toolbar':toolbar}}:{})});
    }
    const scroll=registry.getPlugin('scroll')?.provides?.() as ScrollCapability|undefined;if(!scroll)return;
    const viewport=registry.getPlugin('viewport')?.provides?.() as ViewportCapability|undefined;
    const zoom=registry.getPlugin('zoom')?.provides?.() as ZoomCapability|undefined;
    if(zoom){
      let previous=(saved.pdfZoom||'automatic') as ZoomLevel;
      subscriptions.push(zoom.onZoomChange(event=>{if(event.level===previous)return;previous=event.level;if(changed())options.state?.update({pdfZoom:event.level});}));
      const wheel=(event:WheelEvent)=>{
        if(!(event.ctrlKey||event.metaKey)||!event.deltaY)return;
        event.preventDefault();event.stopImmediatePropagation();
        if(scroll.getTotalPages())zoom.requestZoomBy(event.deltaY>0?-.05:.05);
      };
      host.addEventListener('wheel',wheel,{capture:true,passive:false});
      subscriptions.push(()=>host.removeEventListener('wheel',wheel,true));
    }
    const spread=registry.getPlugin('spread')?.provides?.() as SpreadCapability|undefined;
    if(spread){let previous=saved.pdfSpread||'none';subscriptions.push(spread.onSpreadChange(event=>{if(previous===event.spreadMode)return;previous=event.spreadMode;if(changed())options.state?.update({pdfSpread:event.spreadMode});}));}
    const rotate=registry.getPlugin('rotate')?.provides?.() as RotateCapability|undefined;
    if(rotate){let previous=saved.pdfRotation||0;subscriptions.push(rotate.onRotateChange(event=>{if(previous===event.rotation)return;previous=event.rotation;if(changed())options.state?.update({pdfRotation:event.rotation});}));}
    const pan=registry.getPlugin('pan')?.provides?.() as PanCapability|undefined;
    if(pan){let previous=!!saved.pdfPan;subscriptions.push(pan.onPanModeChange(event=>{if(previous===event.isPanMode)return;previous=event.isPanMode;if(changed())options.state?.update({pdfPan:event.isPanMode});}));}
    let strategy=saved.pdfScroll||'vertical';subscriptions.push(scroll.onStateChange(event=>{if(strategy===event.strategy)return;strategy=event.strategy;if(changed())options.state?.update({pdfScroll:event.strategy});}));
    const restoreSidebar=(documentId:string)=>{if(!ui||!sidebar||!ui.getSchema().sidebars[sidebar.id])return;const scope=ui.forDocument(documentId);if(sidebar.open)scope.setActiveSidebar(sidebar.placement,sidebar.slot,sidebar.id,sidebar.tab);else{scope.closeSidebarSlot(sidebar.placement,sidebar.slot);if(sidebar.tab)scope.setSidebarTab(sidebar.id,sidebar.tab);}};
    const currentSidebar=()=>{const documentId=manager?.getActiveDocument()?.id;if(!ui||!sidebar||!documentId)return;const scope=ui.forDocument(documentId),tab=scope.getSidebarTab(sidebar.id);return {placement:sidebar.placement,slot:sidebar.slot,id:sidebar.id,open:scope.isSidebarOpen(sidebar.placement,sidebar.slot,sidebar.id),...(tab?{tab}:{})};};
    const captureSidebar=()=>{
      if(!changed()||disposed)return;const current=currentSidebar();if(!current)return;sidebar=current;
      const stamp=JSON.stringify(current);if(stamp===sidebarStamp)return;sidebarStamp=stamp;options.state?.update({pdfSidebar:current});
    };
    if(ui){subscriptions.push(ui.onSidebarChanged(event=>{sidebar={placement:event.placement,slot:event.slot,id:event.sidebarId,open:false};captureSidebar();}));const click=()=>queueMicrotask(captureSidebar);host.addEventListener('click',click,true);host.addEventListener('keyup',click,true);subscriptions.push(()=>{host.removeEventListener('click',click,true);host.removeEventListener('keyup',click,true);});}
    if(!options.path)return;
    const initial=/[#&]page=(\d+)/i.exec(url)?.[1],key=attachmentViewKey(options.path),savedPage=saved.pdfPage??rememberedPage(key,initial?Math.max(1,Number(initial)):1);
    let target=savedPage,lastPage=savedPage,restoreFrame=0,pageFrame=0,prepared=false;
    const remember=(page:number)=>{
      if(page===lastPage)return;lastPage=page;
      if(options.state)options.state.update({pdfPage:page});else rememberPage(key,page);
    };
    cancelInitialRestore=()=>{
      if(!initializing||!scroll.getTotalPages())return;
      cancelAnimationFrame(restoreFrame);cancelAnimationFrame(pageFrame);
      restored=true;initializing=false;
      // Once a user acts on the visible reader, a queued restore must not
      // replay over that action on the next frame.
      remember(scroll.getCurrentPage());
    };
    subscriptions.push(()=>{cancelAnimationFrame(restoreFrame);cancelAnimationFrame(pageFrame);});
    const restore=(documentId?:string)=>{
      if(interacted||disposed)return;const current=documentId?scroll.forDocument(documentId):scroll,total=current.getTotalPages();if(!total)return;
      if(viewport?.isGated(documentId))return;
      const metrics=viewport?.getMetrics();if(metrics&&(!metrics.clientWidth||!metrics.clientHeight))return;
      if(restored&&!initializing&&current.getCurrentPage()===target)return;
      restored=true;target=Math.min(options.state?.get().pdfPage??savedPage,total);lastPage=target;
      const id=documentId||manager?.getActiveDocument()?.id;
      if(!prepared){
        prepared=true;applying=true;
        try{
          if(typeof saved.pdfZoom==='number'&&id)zoom?.forDocument(id).requestZoom(saved.pdfZoom);
          if(id){restoreSidebar(id);sidebarStamp=JSON.stringify(currentSidebar()||'');}
        }finally{applying=false;}
      }
      if(target!==savedPage&&!options.state)rememberPage(key,target);
      // Let the new scale/layout reach the DOM before scrolling. Restoring
      // inside the SDK's layout callback races its own initial zoom scroll.
      pageFrame=requestAnimationFrame(()=>{
        if(disposed)return;initializing=false;holdingPage=true;
        // The SDK may already report the target before its DOM scroll offset
        // has been restored. Always restore the offset, not just the number.
        current.scrollToPage({pageNumber:target,behavior:'instant',alignY:0});
      });
    };
    const scheduleRestore=(documentId?:string)=>{if(interacted||disposed)return;cancelAnimationFrame(restoreFrame);cancelAnimationFrame(pageFrame);restoreFrame=requestAnimationFrame(()=>restore(documentId));};
    subscriptions.push(scroll.onLayoutReady(event=>scheduleRestore(event.documentId)));
    if(viewport)subscriptions.push(viewport.onViewportResize(event=>scheduleRestore(event.documentId)));
    if(viewport)subscriptions.push(viewport.onGateChange(event=>{if(!event.isGated)scheduleRestore(event.documentId);}));
    subscriptions.push(scroll.onPageChangeState(event=>{
      if(!event.state.isChanging||holdingPage||!changed()||disposed)return;
      // Command state arrives before the viewport's asynchronous page event.
      // Retain that requested page until superseded by user input.
      target=event.state.targetPage;holdingPage=true;remember(target);
    }));
    subscriptions.push(scroll.onPageChange(event=>{
      // A command/restore keeps its requested page until the next gesture.
      // Layout may report the first page of a spread after visiting its second.
      // Unaccepted layout events must not advance the last persisted page.
      // Horizontal layouts can fit multiple pages before the first paint. SDK
      // visibility metrics then prefer page 1 after the saved page was applied.
      // Reconcile on that event while untouched; never replay after user input.
      if(!interacted){if(restored&&event.pageNumber!==target)scheduleRestore(event.documentId);return;}
      if(holdingPage||!changed()||disposed)return;
      remember(event.pageNumber);
    }));
    let previous=saved;
    subscriptions.push(options.state?.subscribe(()=>{
      const next=options.state!.get(),old=previous;previous=next;if(!restored||disposed)return;applying=true;
      try{
        if(next.pdfZoom!==undefined&&next.pdfZoom!==old.pdfZoom&&zoom?.getState().zoomLevel!==next.pdfZoom)zoom?.requestZoom(next.pdfZoom as ZoomLevel);
        if(next.pdfSpread&&next.pdfSpread!==old.pdfSpread&&spread?.getSpreadMode()!==next.pdfSpread)spread?.setSpreadMode(next.pdfSpread as SpreadMode);
        if(next.pdfRotation!==undefined&&next.pdfRotation!==old.pdfRotation&&rotate?.getRotation()!==next.pdfRotation)rotate?.setRotation(next.pdfRotation as Rotation);
        if(next.pdfScroll&&next.pdfScroll!==old.pdfScroll&&strategy!==next.pdfScroll)scroll.setScrollStrategy(next.pdfScroll as ScrollStrategy);
        if(next.pdfPan!==undefined&&next.pdfPan!==old.pdfPan&&pan?.isPanMode()!==next.pdfPan){if(next.pdfPan)pan?.enablePan();else pan?.disablePan();}
        if(next.pdfPage&&next.pdfPage!==old.pdfPage&&scroll.getCurrentPage()!==next.pdfPage){
          const pending=scroll.getPageChangeState();
          if(!pending.isChanging||pending.targetPage!==next.pdfPage){target=Math.min(next.pdfPage,scroll.getTotalPages());lastPage=target;holdingPage=true;scroll.scrollToPage({pageNumber:target,behavior:'instant',alignY:0});}
        }
        if(next.pdfSidebar&&JSON.stringify(next.pdfSidebar)!==JSON.stringify(old.pdfSidebar)){sidebar=next.pdfSidebar;const id=manager?.getActiveDocument()?.id;if(id&&JSON.stringify(currentSidebar())!==JSON.stringify(sidebar))restoreSidebar(id);sidebarStamp=JSON.stringify(currentSidebar()||'');}
      }finally{applying=false;}
    })||(()=>{}));
    scheduleRestore();
  }).catch(failure=>{if(!disposed)reportAttachmentViewError(failure);});
  return viewer as EmbedPdfContainer;
}
