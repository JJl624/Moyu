package app.moyu.notes;

import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.*;

/** One shared connection pool; cancellation never blocks the document I/O queue. */
final class WebDavTransport {
    private static final OkHttpClient shared=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(20,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).writeTimeout(30,TimeUnit.SECONDS).callTimeout(60,TimeUnit.SECONDS).build();
    private static final Map<String,Call> active=new ConcurrentHashMap<>();
    private static final Map<String,Long> cancelled=new ConcurrentHashMap<>();
    private final OkHttpClient client;
    WebDavTransport(){this(shared);}
    WebDavTransport(OkHttpClient client){this.client=client;}
    static void cancel(String job){if(job.isEmpty())return;cancelled.put(job,System.currentTimeMillis());for(Map.Entry<String,Call> entry:active.entrySet())if(entry.getKey().startsWith(job+"-"))entry.getValue().cancel();}
    private static void check(String id) throws IOException {long now=System.currentTimeMillis();for(Map.Entry<String,Long> entry:cancelled.entrySet()){if(now-entry.getValue()>120000){cancelled.remove(entry.getKey(),entry.getValue());continue;}if(id.startsWith(entry.getKey()+"-"))throw new IOException("已取消同步。");}}
    JSONObject request(JSONObject input) throws Exception {
        URL url=new URL(input.getString("url"));
        if(!"https".equals(url.getProtocol())||url.getHost().isEmpty()||url.getUserInfo()!=null)throw new IOException("WebDAV 地址需使用 HTTPS，用户名和密码请分别填写。");
        String method=input.getString("method"),id=input.getString("id");
        if(!Arrays.asList("GET","HEAD","PUT","PROPFIND","MKCOL","DELETE").contains(method))throw new IOException("请求方法无效。");
        for(int redirect=0;redirect<4;redirect++) {
            check(id);
            Request.Builder request=new Request.Builder().url(url).header("User-Agent","Moyu-Android/"+BuildConfig.VERSION_NAME).header("Authorization",Credentials.basic(input.optString("username"),input.optString("password"),StandardCharsets.UTF_8));
            JSONObject headers=input.optJSONObject("headers");
            if(headers!=null)for(Iterator<String> keys=headers.keys();keys.hasNext();){String key=keys.next();if(Arrays.asList("depth","content-type","if-match","if-none-match").contains(key.toLowerCase(Locale.ROOT)))request.header(key,headers.getString(key));}
            RequestBody body=null;
            if(input.has("body")||method.equals("PUT")){byte[] bytes=input.optBoolean("binary")?Base64.decode(input.optString("body"),Base64.DEFAULT):input.optString("body").getBytes(StandardCharsets.UTF_8);body=RequestBody.create(bytes,null);}
            int timeout=input.optInt("timeout",60);if(timeout<5||timeout>600)throw new IOException("连接超时时间无效。");
            Call call=client.newBuilder().callTimeout(timeout,TimeUnit.SECONDS).connectTimeout(timeout,TimeUnit.SECONDS).readTimeout(timeout,TimeUnit.SECONDS).writeTimeout(timeout,TimeUnit.SECONDS).build().newCall(request.method(method,body).build());active.put(id,call);
            try {
                check(id);
                try(Response response=call.execute()){
                    int status=response.code();
                    if(status==307||status==308||status==301||status==302){
                        String location=response.header("Location");if(location==null)throw new IOException("服务器重定向缺少目标地址。");URL next=new URL(url,location);
                        if(!next.getProtocol().equals("https")||!next.getHost().equalsIgnoreCase(url.getHost())||(next.getPort()==-1?443:next.getPort())!=(url.getPort()==-1?443:url.getPort()))throw new IOException("服务器将请求重定向到其他地址，请填写最终的 WebDAV 地址。");
                        url=next;continue;
                    }
                    byte[] bytes=response.body()==null?new byte[0]:response.body().bytes();check(id);
                    return new JSONObject().put("status",status).put("etag",response.header("ETag","")).put("modified",response.header("Last-Modified","")).put("retryAfter",response.header("Retry-After","")).put("body",input.optBoolean("responseBinary")?Base64.encodeToString(bytes,Base64.NO_WRAP):new String(bytes,StandardCharsets.UTF_8));
                }
            }finally{active.remove(id,call);}
        }throw new IOException("服务器重定向次数过多。");
    }
}
