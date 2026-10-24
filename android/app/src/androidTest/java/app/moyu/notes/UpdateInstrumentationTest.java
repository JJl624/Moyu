package app.moyu.notes;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.json.JSONObject;
import okhttp3.*;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

@RunWith(AndroidJUnit4.class)
public class UpdateInstrumentationTest {
    @Test public void publicMetadataUsesAnIsolatedCredentialFreeRequest() throws Exception {
        OkHttpClient client=new OkHttpClient.Builder().addInterceptor(chain->{
            Request request=chain.request();assertEquals("api.github.com",request.url().host());assertEquals("GET",request.method());assertNull(request.header("Authorization"));assertTrue(request.header("User-Agent").endsWith(BuildConfig.VERSION_NAME));
            return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(ResponseBody.create("{\"tag_name\":\"v1.0.20\"}",MediaType.get("application/json"))).build();
        }).build();
        JSONObject value=UpdateTransport.request(new JSONObject().put("kind","latest"),client);assertEquals(200,value.getInt("status"));assertEquals("v1.0.20",new JSONObject(value.getString("body")).getString("tag_name"));
    }
    @Test public void metadataIsBoundedAndForeignDownloadAddressesAreRejectedBeforeRequest() throws Exception {
        AtomicInteger calls=new AtomicInteger();OkHttpClient client=new OkHttpClient.Builder().addInterceptor(chain->{calls.incrementAndGet();return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(ResponseBody.create(new byte[262145],MediaType.get("application/json"))).build();}).build();
        try{UpdateTransport.request(new JSONObject().put("kind","latest"),client);fail("oversized metadata");}catch(IOException expected){assertTrue(expected.getMessage().contains("过大"));}
        assertEquals(1,calls.get());
        try{UpdateTransport.request(new JSONObject().put("kind","asset").put("url","https://example.com/moyu.apk"),client);fail("foreign URL");}catch(IOException expected){assertTrue(expected.getMessage().contains("无效"));}assertEquals(1,calls.get());
    }
}
