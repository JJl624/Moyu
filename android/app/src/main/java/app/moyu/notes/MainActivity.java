package app.moyu.notes;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.core.content.FileProvider;
import androidx.webkit.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final String ORIGIN="https://appassets.androidplatform.net";
    private WebView web;
    private SystemBarsLayout rootView;
    private NativeBridge bridge;
    private volatile WebDavTransport webDavTransport;
    private final java.util.concurrent.ExecutorService network=Executors.newFixedThreadPool(2);
    private final Map<Integer,Picker> pickers=new HashMap<>();
    private int requestCode=100;
    private volatile boolean destroyed=false;
    private boolean keyboardVisible=false;
    interface Reply {void done(Object value,Exception error);}
    interface Picker {void finish(int result,Intent data) throws Exception;}
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        SystemBarsLayout content=new SystemBarsLayout(this);rootView=content;boolean systemDark=(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;int initial=systemDark?Color.rgb(29,31,36):Color.rgb(246,247,250);content.setBarColors(initial,initial);setContentView(content);
        web=new WebView(this);web.setDefaultFocusHighlightEnabled(false);web.setVerticalScrollBarEnabled(false);web.setHorizontalScrollBarEnabled(false);content.addView(web,new FrameLayout.LayoutParams(-1,-1));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);getWindow().setStatusBarContrastEnforced(false);getWindow().setNavigationBarContrastEnforced(false);
        if(Build.VERSION.SDK_INT>=30){getWindow().setDecorFitsSystemWindows(false);content.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()),ime=insets.getInsets(WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));updateKeyboard(insets);return insets;});}
        else{getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);content.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());updateKeyboard(insets);return insets;});}
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);
        settings.setTextZoom(100);settings.setBuiltInZoomControls(false);settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        bridge=new NativeBridge(this);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(ORIGIN.equals(uri.getScheme()+"://"+uri.getHost())&&uri.getPath()!=null&&uri.getPath().startsWith("/vault/")) {
                    try{bridge.initialize();String path=uri.getPath().substring(7);InputStream stream=bridge.vault.open(path);String type=VaultStore.mime(path);if(type.equals("text/html")||type.contains("javascript"))type="text/plain";return new WebResourceResponse(type,null,200,"OK",Collections.singletonMap("Content-Security-Policy","default-src 'none'; sandbox"),stream);}
                    catch(Exception error){return new WebResourceResponse("text/plain","UTF-8",404,"Not found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
                }
                return loader.shouldInterceptRequest(uri);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(request.isForMainFrame()) {if(url.startsWith(ORIGIN+"/assets/web/"))return false;openExternal(url);return true;}
                return false;
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showStartupError("页面未能加载，请重启应用。文档仍保存在原位置。");}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(dialog,which)->result.confirm()).setNegativeButton("取消",(dialog,which)->result.cancel()).setOnCancelListener(dialog->result.cancel()).show();return true;}
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(dialog,which)->result.confirm()).setOnCancelListener(dialog->result.confirm()).show();return true;}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams parameters){try{Intent intent=parameters.createIntent();launch(intent,(result,data)->callback.onReceiveValue(FileChooserParams.parseResult(result,data)),callback::onReceiveValue);}catch(Exception error){callback.onReceiveValue(null);}return true;}
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){showStartupError("请先更新 Android System WebView，再打开墨屿。");return;}
        WebViewCompat.addWebMessageListener(web,"MoyuNative",Collections.singleton(ORIGIN),(view,message,source,isMainFrame,reply)->{if(isMainFrame&&"https".equals(source.getScheme())&&"appassets.androidplatform.net".equals(source.getHost())&&(source.getPort()==-1||source.getPort()==443))bridge.request(message.getData(),reply);});
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
        web.loadUrl(ORIGIN+"/assets/web/mobile.html");
    }
    void event(String name){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event("+JSONObject.quote(name)+"))",null);}
    private void handleBack(){
        WindowInsets insets=web.getRootWindowInsets();
        boolean keyboard=insets!=null&&(Build.VERSION.SDK_INT>=30?insets.isVisible(WindowInsets.Type.ime()):insets.getSystemWindowInsetBottom()>120*getResources().getDisplayMetrics().density);
        if(keyboard){((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0);web.evaluateJavascript("document.activeElement?.blur()",null);return;}
        event("moyu-mobile-back");
    }
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onPause(){event("moyu-mobile-pause");super.onPause();}
    @Override protected void onResume(){super.onResume();event("moyu-mobile-resume");}
    @Override protected void onDestroy(){destroyed=true;network.shutdownNow();if(bridge!=null)bridge.io.shutdown();if(web!=null){web.removeAllViews();web.destroy();}super.onDestroy();}
    void deliver(JavaScriptReplyProxy proxy,String message){runOnUiThread(()->{if(!destroyed)try{proxy.postMessage(message);}catch(IllegalStateException ignored){}});}
    @Override public void onConfigurationChanged(Configuration configuration){super.onConfigurationChanged(configuration);event("moyu-mobile-resize");}
    void showStartupError(String message){runOnUiThread(()->new AlertDialog.Builder(this).setTitle("墨屿").setMessage(message).setPositiveButton("关闭",(d,w)->finish()).show());}
    private void launch(Intent intent,Picker picker,java.util.function.Consumer<Uri[]> cancelled) throws Exception {
        int code=++requestCode;pickers.put(code,picker);try{startActivityForResult(intent,code);}catch(Exception error){pickers.remove(code);if(cancelled!=null)cancelled.accept(null);else throw new IOException("没有可用于选择文件的系统应用。",error);}
    }
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);Picker picker=pickers.remove(code);if(picker!=null)try{picker.finish(result,data);}catch(Exception error){showStartupError(error.getMessage());}}
    private void updateKeyboard(WindowInsets insets){
        boolean visible=Build.VERSION.SDK_INT>=30?insets.isVisible(WindowInsets.Type.ime()):insets.getSystemWindowInsetBottom()>insets.getStableInsetBottom();
        if(visible==keyboardVisible)return;keyboardVisible=visible;
        if(!destroyed&&web!=null)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('moyu-mobile-keyboard',{detail:"+visible+"}))",null);
    }
    void openExternal(String url){try{Uri uri=Uri.parse(url);if(Arrays.asList("https","http","mailto","tel").contains(uri.getScheme()))startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception error){Toast.makeText(this,"没有可打开此链接的应用。",Toast.LENGTH_SHORT).show();}}
    boolean dispatchPicker(String method,JSONArray args,Reply reply) throws Exception {
        String action=method.equals("feature")?args.optString(0):method;JSONObject input=method.equals("feature")?args.optJSONObject(1):new JSONObject();if(input==null)input=new JSONObject();final JSONObject options=input;
        if(action.equals("mobile.webdav-request")) {network.execute(()->{try{WebDavTransport transport=webDavTransport;if(transport==null)webDavTransport=transport=new WebDavTransport();reply.done(transport.request(options),null);}catch(Exception error){reply.done(null,error);}});return true;}
        if(action.equals("mobile.webdav-cancel")){WebDavTransport.cancel(input.optString("job"));reply.done(true,null);return true;}
        if(action.equals("mobile.update-request")){network.execute(()->{try{reply.done(UpdateTransport.request(options),null);}catch(Exception error){reply.done(null,new IOException("无法连接 GitHub，请稍后重试。"));}});return true;}
        if(action.equals("mobile.finish")){reply.done(true,null);finish();return true;}
        if(action.equals("mobile.keyboard-visible")){reply.done(keyboardVisible,null);return true;}
        if(action.equals("mobile.copy-text")){((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("代码",input.getString("text")));reply.done(true,null);return true;}
        if(action.equals("mobile.share-files")){
            bridge.io.execute(()->{try{
                bridge.initialize();if(!options.optString("root").equals(bridge.vault.root()))throw new IOException("知识库已切换。");
                JSONArray paths=options.getJSONArray("paths");if(paths.length()==0)throw new IOException("未选择文件。");
                File session=new File(getCacheDir(),"shared/"+UUID.randomUUID());ArrayList<Uri> uris=new ArrayList<>();
                for(int i=0;i<paths.length();i++){
                    String path=paths.getString(i);VaultPaths.checked(path);
                    File target=new File(session,i+"/"+VaultPaths.name(path));if(!target.getParentFile().mkdirs()&&!target.getParentFile().isDirectory())throw new IOException("无法准备分享文件。");
                    try(InputStream source=bridge.vault.open(path);OutputStream output=new FileOutputStream(target)){byte[] buffer=new byte[32768];int count;while((count=source.read(buffer))!=-1)output.write(buffer,0,count);}
                    uris.add(FileProvider.getUriForFile(this,getPackageName()+".files",target));
                }
                runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);ClipData clip=ClipData.newRawUri("文件",uris.get(0));for(int i=1;i<uris.size();i++)clip.addItem(new ClipData.Item(uris.get(i)));intent.setClipData(clip);startActivity(Intent.createChooser(intent,"分享文件"));reply.done(true,null);}catch(Exception error){reply.done(null,new IOException("无法打开分享面板。",error));}});
            }catch(Exception error){reply.done(null,error);}});return true;
        }
        if(action.equals("mobile.theme")){
            boolean dark="dark".equals(input.optString("theme"));String background=input.optString("background",dark?"#1d1f24":"#ffffff"),navigation=input.optString("navigationBackground",background);
            if(!background.matches("#[0-9a-fA-F]{6}")||!navigation.matches("#[0-9a-fA-F]{6}"))throw new IOException("无效的界面颜色。");
            int top=Color.parseColor(background),bottom=Color.parseColor(navigation);rootView.setBarColors(top,bottom);
            boolean lightStatus=androidx.core.graphics.ColorUtils.calculateLuminance(top)>0.179,lightNavigation=androidx.core.graphics.ColorUtils.calculateLuminance(bottom)>0.179;
            if(Build.VERSION.SDK_INT>=30){WindowInsetsController controller=getWindow().getInsetsController();if(controller!=null)controller.setSystemBarsAppearance((lightStatus?WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS:0)|(lightNavigation?WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS:0),WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);}
            else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|(lightStatus?View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR:0)|(lightNavigation?View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR:0));
            reply.done(true,null);return true;
        }
        if(action.equals("openExternal")){openExternal(args.optString(0));reply.done(true,null);return true;}
        if(action.equals("mobile.open-file")){bridge.io.execute(()->{try{bridge.initialize();String path=options.getString("path");File target=new File(getCacheDir(),"shared/"+VaultPaths.name(path));VaultStore.writePrivate(target,bridge.vault.bytes(path));Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",target);runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,VaultStore.mime(path)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));reply.done(true,null);}catch(Exception error){reply.done(null,new IOException("没有可打开此文件的应用。"));}});}catch(Exception error){reply.done(null,error);}});return true;}
        if(action.equals("openVault")) {
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            launch(intent,(result,data)->{if(result!=RESULT_OK||data==null||data.getData()==null){reply.done(null,null);return;}try{Uri uri=data.getData();getContentResolver().takePersistableUriPermission(uri,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));bridge.io.execute(()->{try{bridge.initialize();bridge.vault.select(uri);reply.done(bridge.vault.list(),null);}catch(Exception error){reply.done(null,error);}});}catch(Exception error){reply.done(null,new IOException("未获得文件夹访问权限，请重新选择。",error));}},null);return true;
        }
        if(action.equals("importFiles")||action.equals("mobile.import-files")||action.equals("mobile.pick-attachment")) {
            boolean attachment=action.equals("mobile.pick-attachment");Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
            if(!attachment)intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"text/*","application/octet-stream"});
            launch(intent,(result,data)->{if(result!=RESULT_OK||data==null){reply.done(new JSONArray(),null);return;}List<Uri> files=new ArrayList<>();if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)files.add(data.getClipData().getItemAt(i).getUri());else if(data.getData()!=null)files.add(data.getData());
                bridge.io.execute(()->{try{bridge.initialize();String destination=attachment?"":options.optString("folder","");if(!destination.isEmpty()){VaultPaths.checked(destination);if(!bridge.vault.exists(destination))throw new IOException("目标文件夹不存在。");}String prefix=destination.isEmpty()?"":destination+"/";JSONArray imported=new JSONArray();for(Uri uri:files){String name=fileName(uri);byte[] bytes;try(InputStream stream=getContentResolver().openInputStream(uri)){if(stream==null)throw new IOException("无法读取文件。");bytes=VaultStore.readBytes(stream);}
                    if(attachment)imported.put(bridge.attachment(options.getString("document"),name,bytes));
                    else{String target=prefix+name;int index=1;while(bridge.vault.exists(target)){int dot=name.lastIndexOf('.');target=prefix+(dot>0?name.substring(0,dot)+" ("+index+++")"+name.substring(dot):name+" ("+index+++")");}bridge.vault.write(target,bytes,true);imported.put(target);}}
                    reply.done(imported,null);}catch(Exception error){reply.done(null,error);}});
            },null);return true;
        }
        if(action.equals("exportFile")||action.equals("mobile.share")) {
            boolean share=action.equals("mobile.share");String kind=share?"md":args.getString(0),name=share?input.getString("name"):args.getString(1),text=share?input.getString("content"):args.getString(2);
            String filename=VaultPaths.name(name).replaceFirst("(?i)\\.(md|markdown)$","")+"."+kind;
            if(share){File target=new File(getCacheDir(),"shared/"+VaultPaths.name(filename));VaultStore.writePrivate(target,text.getBytes(StandardCharsets.UTF_8));Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",target);Intent intent=new Intent(Intent.ACTION_SEND).setType("text/markdown").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(intent,"分享文档"));reply.done(true,null);}
            else launch(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(kind.equals("md")?"text/markdown":"text/html").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,filename),(result,data)->{if(result!=RESULT_OK||data==null||data.getData()==null){reply.done(false,null);return;}bridge.io.execute(()->{try(OutputStream output=getContentResolver().openOutputStream(data.getData(),"wt")){if(output==null)throw new IOException("无法保存导出文件。");output.write(text.getBytes(StandardCharsets.UTF_8));reply.done(true,null);}catch(Exception error){reply.done(null,error);}});},null);
            return true;
        }
        if(action.equals("exportPDF")){String name=args.getString(0),html=args.getString(1);WebView print=new WebView(this);print.setWebViewClient(new WebViewClient(){@Override public void onPageFinished(WebView view,String url){((PrintManager)getSystemService(PRINT_SERVICE)).print(name,print.createPrintDocumentAdapter(name),null);reply.done(true,null);}});print.loadDataWithBaseURL(ORIGIN+"/assets/web/",html,"text/html","UTF-8",null);return true;}
        return false;
    }
    private String fileName(Uri uri){try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst()){String name=cursor.getString(0);VaultPaths.checked(name);if(!name.contains("/"))return name;}}catch(Exception ignored){}return "附件-"+System.currentTimeMillis();}
}
