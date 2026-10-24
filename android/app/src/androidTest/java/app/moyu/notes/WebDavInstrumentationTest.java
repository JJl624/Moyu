package app.moyu.notes;

import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.junit.Assume;
import org.json.JSONObject;
import javax.net.ssl.*;
import java.security.cert.X509Certificate;
import java.util.concurrent.*;

/** A test-only trust override for the disposable emulator's local HTTPS fixture. */
@RunWith(AndroidJUnit4.class)
public class WebDavInstrumentationTest {
    @Test public void nativeWebDavMethodsValidatorsAndCancellation() throws Exception {
        String url=InstrumentationRegistry.getArguments().getString("davUrl");Assume.assumeTrue(url!=null&&url.startsWith("https://10.0.2.2:18443/"));
        X509TrustManager trust=new X509TrustManager(){public void checkClientTrusted(X509Certificate[] chain,String auth){}public void checkServerTrusted(X509Certificate[] chain,String auth){}public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}};
        SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(null,new TrustManager[]{trust},null);
        ExecutorService executor=Executors.newSingleThreadExecutor();
        try{
            WebDavTransport transport=new WebDavTransport(new okhttp3.OkHttpClient.Builder().sslSocketFactory(ssl.getSocketFactory(),trust).hostnameVerifier((host,session)->host.equals("10.0.2.2")).build());
            JSONObject request=new JSONObject().put("url",url).put("id","test-1").put("method","PROPFIND").put("username","user").put("password","secret").put("headers",new JSONObject().put("Depth","1"));
            assertEquals(207,transport.request(request).getInt("status"));
            request.put("url",url+"limited");JSONObject limited=transport.request(request);assertEquals(503,limited.getInt("status"));assertEquals("120",limited.getString("retryAfter"));
            request.put("method","GET").put("url",url+"original.md");JSONObject get=transport.request(request);assertEquals(200,get.getInt("status"));assertEquals("原文\n第二行",get.getString("body"));
            request.put("method","PUT").put("body","不可覆盖").put("headers",new JSONObject().put("If-Match","\"stale\""));assertEquals(412,transport.request(request).getInt("status"));
            request.put("url",url+"native-"+java.util.UUID.randomUUID()+".txt").put("headers",new JSONObject().put("If-None-Match","*")).put("body","保存内容");assertEquals(201,transport.request(request).getInt("status"));
            request.remove("body");request.remove("headers");request.put("method","GET");assertEquals("保存内容",transport.request(request).getString("body"));
            request.put("method","MKCOL").put("url",url+"folder-"+java.util.UUID.randomUUID());assertEquals(201,transport.request(request).getInt("status"));
            JSONObject slow=new JSONObject().put("url",url+"slow").put("id","cancel-test-1").put("method","GET").put("username","user").put("password","secret");
            Future<?> work=executor.submit(()->{try{transport.request(slow);throw new AssertionError("must cancel");}catch(java.io.IOException expected){}catch(Exception error){throw new RuntimeException(error);}});
            Thread.sleep(400);WebDavTransport.cancel("cancel-test");work.get(3,TimeUnit.SECONDS);
        }finally{executor.shutdownNow();}
    }
}
