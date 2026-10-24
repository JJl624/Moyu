package app.moyu.notes;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.X509Certificate;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Real Activity lifecycle, native storage and HTTPS. Trust is injected only
 * into this test Activity; the release transport and system trust are unchanged. */
@RunWith(AndroidJUnit4.class)
public class StartupSyncInstrumentationTest {
    private final android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private OkHttpClient client;
    private String server;
    interface Check {boolean done() throws Exception;}

    private void waitFor(Check check) throws Exception {
        long deadline=System.currentTimeMillis()+45000;
        while(System.currentTimeMillis()<deadline){if(check.done())return;Thread.sleep(100);}
        fail("Timed out waiting for native startup sync");
    }
    private Object js(String source) throws Exception {
        Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);
        WebView web=(WebView)field.get(activity);CompletableFuture<String> value=new CompletableFuture<>();
        instrumentation.runOnMainSync(()->web.evaluateJavascript(source,value::complete));
        return new JSONTokener(value.get(5,TimeUnit.SECONDS)).nextValue();
    }
    private JSONObject control(String path,JSONObject body) throws Exception {
        Request.Builder request=new Request.Builder().url(server+"__test/"+path).header("Authorization",okhttp3.Credentials.basic("user","secret"));
        if(body!=null)request.post(RequestBody.create(body.toString().getBytes(StandardCharsets.UTF_8),null));
        try(Response result=client.newCall(request.build()).execute()){assertEquals(200,result.code());return new JSONObject(result.body().string());}
    }
    private void start() throws Exception {
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        waitFor(()->Boolean.TRUE.equals(js("!!document.querySelector('.mobile-mode-tabs [aria-selected=true]')")));
    }
    private void restart() throws Exception {
        finishActivity();start();
    }
    private void finishActivity() throws Exception {
        MainActivity previous=activity;Field field=MainActivity.class.getDeclaredField("bridge");field.setAccessible(true);NativeBridge bridge=(NativeBridge)field.get(previous);
        instrumentation.runOnMainSync(previous::finish);waitFor(previous::isDestroyed);assertTrue(bridge.io.awaitTermination(5,TimeUnit.SECONDS));
    }
    private void background() throws Exception {instrumentation.runOnMainSync(()->activity.moveTaskToBack(true));Thread.sleep(400);}
    private void foreground() {
        instrumentation.runOnMainSync(()->instrumentation.getTargetContext().startActivity(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
    }
    private void connection(File file,JSONObject config) throws Exception {
        JSONObject connections=new JSONObject().put(VaultPaths.hash("internal"),config);
        VaultStore.writePrivate(file,new JSONObject().put("connections",connections).toString().getBytes(StandardCharsets.UTF_8));
    }
    private JSONObject summary(File settings,String key) throws Exception {
        return new JSONObject(new JSONObject(new String(Files.readAllBytes(settings.toPath()),StandardCharsets.UTF_8)).optString(key+"-summary","{}"));
    }

    @Test public void startupForegroundCancellationRetriesAndAuthentication() throws Exception {
        server=InstrumentationRegistry.getArguments().getString("davUrl");
        Assume.assumeTrue(server!=null&&server.startsWith("https://10.0.2.2:18443/"));
        Context context=instrumentation.getTargetContext();assertTrue(context.getPackageName().endsWith(".debug"));
        X509TrustManager trust=new X509TrustManager(){public void checkClientTrusted(X509Certificate[] chain,String auth){}public void checkServerTrusted(X509Certificate[] chain,String auth){}public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}};
        SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(null,new TrustManager[]{trust},null);
        client=new OkHttpClient.Builder().sslSocketFactory(ssl.getSocketFactory(),trust).hostnameVerifier((host,session)->host.equals("10.0.2.2")).build();
        WebDavTransport transport=new WebDavTransport(client);
        Application application=(Application)context.getApplicationContext();
        Application.ActivityLifecycleCallbacks callbacks=new Application.ActivityLifecycleCallbacks(){
            @Override public void onActivityPreCreated(Activity value,Bundle state){if(value instanceof MainActivity)try{Field field=MainActivity.class.getDeclaredField("webDavTransport");field.setAccessible(true);field.set(value,transport);}catch(Exception error){throw new RuntimeException(error);}}
            public void onActivityCreated(Activity value,Bundle state){}public void onActivityStarted(Activity value){}public void onActivityResumed(Activity value){}public void onActivityPaused(Activity value){}public void onActivityStopped(Activity value){}public void onActivitySaveInstanceState(Activity value,Bundle state){}public void onActivityDestroyed(Activity value){}
        };
        File settings=new File(context.getFilesDir(),"settings.json"),connections=new File(context.getFilesDir(),"webdav.json");
        byte[] oldSettings=settings.exists()?Files.readAllBytes(settings.toPath()):null,oldConnections=connections.exists()?Files.readAllBytes(connections.toPath()):null;
        String oldRoot=context.getSharedPreferences("workspace",0).getString("tree","");
        VaultStore store=new VaultStore(context);store.select(null);
        String folder="startup-sync-qa-"+System.nanoTime(),note=folder+"/note.md",directory="/"+folder,remote=directory+"/"+note;
        store.create(note,"file","初始内容");
        StringBuilder excludes=new StringBuilder();JSONArray roots=store.list().getJSONArray("tree");
        for(int index=0;index<roots.length();index++){JSONObject node=roots.getJSONObject(index);if(!node.getString("name").equals(folder))excludes.append(node.getString("name")).append("folder".equals(node.getString("kind"))?"/\n":"\n");}
        JSONObject sync=new JSONObject().put("onOpen",true).put("afterSave",false).put("retries",1).put("excludes",excludes.toString());
        JSONObject config=new JSONObject().put("url",server).put("directory",directory).put("username","user").put("password","secret").put("sync",sync);
        String key="moyu-mobile-sync-"+VaultPaths.hash("internal\n"+server+folder+"/\nuser");
        connection(connections,config);application.registerActivityLifecycleCallbacks(callbacks);
        try{
            start();waitFor(()->summary(settings,key).optBoolean("needsConfirmation"));
            assertFalse(control("state",null).getJSONObject("files").has(remote));
            js("document.querySelector('[aria-label=返回笔记]').click();true");
            waitFor(()->Boolean.TRUE.equals(js("!!document.querySelector('[aria-label=立即同步]')")));
            js("document.querySelector('[aria-label=立即同步]').click();true");
            waitFor(()->summary(settings,key).optLong("lastSync")>0);
            assertEquals("初始内容",control("state",null).getJSONObject("files").getString(remote));
            js("document.querySelector('[data-path=\""+folder+"\"] .mobile-file-open').click();true");
            js("document.querySelector('[data-path=\""+note+"\"] .mobile-file-open').click();true");
            waitFor(()->Boolean.TRUE.equals(js("document.querySelector('.reading-view')?.textContent.includes('初始内容')")));

            control("file",new JSONObject().put("path",remote).put("content","启动自动下载"));
            control("fail",new JSONObject().put("method","PROPFIND").put("path",directory).put("status",503));
            restart();waitFor(()->store.read(note).getString("content").equals("启动自动下载"));
            waitFor(()->Boolean.TRUE.equals(js("document.querySelector('.reading-view')?.textContent.includes('启动自动下载')")));
            assertEquals("true",String.valueOf(js("document.querySelector('[role=tab][aria-selected=true]').textContent==='阅读'")));

            background();control("file",new JSONObject().put("path",remote).put("content","返回前台下载"));
            Thread.sleep(1800);assertEquals("启动自动下载",store.read(note).getString("content"));
            foreground();waitFor(()->store.read(note).getString("content").equals("返回前台下载"));

            // A real delayed TLS request must be cancelled by Activity.onPause.
            background();control("file",new JSONObject().put("path",remote).put("content","中断后重新下载"));
            control("delay",new JSONObject().put("method","GET").put("path",remote).put("ms",8000));
            int previousRequests=control("state",null).getJSONArray("requests").length();foreground();
            waitFor(()->{JSONArray requests=control("state",null).getJSONArray("requests");for(int index=previousRequests;index<requests.length();index++){JSONObject request=requests.getJSONObject(index);if(request.optString("method").equals("GET")&&request.optString("path").equals(remote))return true;}return false;});
            background();Thread.sleep(1300);assertEquals("返回前台下载",store.read(note).getString("content"));
            control("delay",new JSONObject());foreground();waitFor(()->store.read(note).getString("content").equals("中断后重新下载"));

            config.put("password","wrong");connection(connections,config);restart();
            waitFor(()->summary(settings,key).optString("error").equals("用户名或密码错误。"));
            assertEquals("中断后重新下载",store.read(note).getString("content"));
            config.put("password","secret");connection(connections,config);control("file",new JSONObject().put("path",remote).put("content","恢复正确密码"));restart();
            waitFor(()->store.read(note).getString("content").equals("恢复正确密码"));

            // A phone save may never overwrite an existing cloud file silently.
            background();store.write(note,"手机的修改".getBytes(StandardCharsets.UTF_8),false);foreground();
            waitFor(()->{JSONArray pending=summary(settings,key).optJSONArray("pendingUploads");if(pending!=null)for(int index=0;index<pending.length();index++)if(note.equals(pending.getString(index)))return true;return false;});
            assertEquals("恢复正确密码",control("state",null).getJSONObject("files").getString(remote));
            js("document.querySelector('[aria-label=返回笔记]').click();true");
            waitFor(()->Boolean.TRUE.equals(js("!!document.querySelector('[aria-label=立即同步]')")));
            js("document.querySelector('[aria-label=立即同步]').click();true");
            waitFor(()->Boolean.TRUE.equals(js("!!document.querySelector('dialog[aria-label=确认覆盖云端]')")));
            js("[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='取消上传').click();true");
            waitFor(()->Boolean.TRUE.equals(js("!document.querySelector('dialog')&&!document.querySelector('[aria-label=立即同步]').disabled")));
            assertEquals("恢复正确密码",control("state",null).getJSONObject("files").getString(remote));
            js("document.querySelector('[aria-label=立即同步]').click();true");
            waitFor(()->Boolean.TRUE.equals(js("!!document.querySelector('dialog[aria-label=确认覆盖云端]')")));
            js("[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='覆盖云端').click();true");
            waitFor(()->control("state",null).getJSONObject("files").getString(remote).equals("手机的修改"));
        }catch(AssertionError error){
            System.out.println("SYNC_DIAGNOSTIC "+summary(settings,key));
            System.out.println("SYNC_LOCAL "+store.read(note).optString("content"));
            System.out.println("SYNC_VIEW "+js("JSON.stringify({visibility:document.visibilityState,error:document.querySelector('[role=alert]')?.textContent,reading:!!document.querySelector('.reading-view')})"));
            throw error;
        }finally{
            if(activity!=null&&!activity.isDestroyed())finishActivity();
            application.unregisterActivityLifecycleCallbacks(callbacks);
            if(store.exists(folder))store.delete(folder);
            if(oldSettings!=null)VaultStore.writePrivate(settings,oldSettings);else settings.delete();
            if(oldConnections!=null)VaultStore.writePrivate(connections,oldConnections);else connections.delete();
            context.getSharedPreferences("workspace",0).edit().putString("tree",oldRoot).commit();
        }
    }
}
