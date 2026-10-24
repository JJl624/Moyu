package app.moyu.notes;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.JSONObject;

/** Public GitHub metadata only; independent from vault and WebDAV credentials. */
final class UpdateTransport {
    private static final String RELEASES="https://github.com/JJl624/Moyu/releases";
    private static final OkHttpClient client=new OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).callTimeout(15,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
    static JSONObject request(JSONObject input) throws Exception {
        return request(input,client);
    }
    static JSONObject request(JSONObject input,OkHttpClient source) throws Exception {
        String kind=input.getString("kind"),url;
        if(kind.equals("latest"))url="https://api.github.com/repos/JJl624/Moyu/releases/latest";
        else if(kind.equals("redirect"))url=RELEASES+"/latest";
        else if(kind.equals("asset")){
            url=input.getString("url");
            if(!url.matches("https://github\\.com/JJl624/Moyu/releases/download/v?[0-9]+\\.[0-9]+\\.[0-9]+/Moyu-Android-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk"))throw new IOException("更新下载地址无效。");
        }else throw new IOException("更新请求无效。");
        Request.Builder builder=new Request.Builder().url(url).header("User-Agent","Moyu-Android/"+BuildConfig.VERSION_NAME).header("Accept","application/vnd.github+json");
        if(kind.equals("asset"))builder.head();
        OkHttpClient transport=kind.equals("asset")?source.newBuilder().followRedirects(true).followSslRedirects(true).build():source;
        try(Response response=transport.newCall(builder.build()).execute()){
            JSONObject result=new JSONObject().put("status",response.code()).put("location",response.header("Location","")).put("size",Long.parseLong(response.header("Content-Length","0")));
            if(kind.equals("latest")&&response.isSuccessful()&&response.body()!=null){
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
                try(InputStream stream=response.body().byteStream()){while((count=stream.read(buffer))!=-1){if(bytes.size()+count>262144)throw new IOException("更新信息过大。");bytes.write(buffer,0,count);}}
                result.put("body",new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            }
            return result;
        }
    }
}
