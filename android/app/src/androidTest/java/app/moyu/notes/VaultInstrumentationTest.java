package app.moyu.notes;

import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import android.content.Intent;

/** Runs on Android, against AtomicFile, SQLite and the real application sandbox. */
@RunWith(AndroidJUnit4.class)
public class VaultInstrumentationTest {
    @Test public void recyclePreservesEmptyFoldersAndCompanionAttachments() throws Exception {
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        NativeBridge bridge=new NativeBridge(activity);bridge.initialize();bridge.vault.select(null);
        String folder="recycle-qa-"+System.currentTimeMillis(),note=folder+"/note.md",asset=folder+"/note.assets/attachments/test.txt";
        try{
            bridge.vault.create(folder+"/empty/nested","folder","");bridge.vault.create(note,"file","note");bridge.vault.write(asset,"asset".getBytes(StandardCharsets.UTF_8),true);
            bridge.invoke("trash",new JSONArray().put(note));assertFalse(bridge.vault.exists(note));assertFalse(bridge.vault.exists(folder+"/note.assets"));
            JSONArray receipts=(JSONArray)bridge.invoke("feature",new JSONArray().put("mobile.trash-list").put(new JSONObject()));String id="";
            for(int i=0;i<receipts.length();i++)if(note.equals(receipts.getJSONObject(i).getString("path")))id=receipts.getJSONObject(i).getString("id");assertFalse(id.isEmpty());
            bridge.invoke("feature",new JSONArray().put("mobile.trash-restore").put(new JSONObject().put("id",id)));assertEquals("asset",new String(bridge.vault.bytes(asset),StandardCharsets.UTF_8));
            bridge.invoke("trash",new JSONArray().put(folder));receipts=(JSONArray)bridge.invoke("feature",new JSONArray().put("mobile.trash-list").put(new JSONObject()));
            for(int i=0;i<receipts.length();i++)if(folder.equals(receipts.getJSONObject(i).getString("path")))id=receipts.getJSONObject(i).getString("id");
            bridge.invoke("feature",new JSONArray().put("mobile.trash-restore").put(new JSONObject().put("id",id)));assertTrue(bridge.vault.exists(folder+"/empty/nested"));assertEquals("note",bridge.vault.read(note).getString("content"));
            String expected=bridge.vault.read(note).getString("version");
            try{bridge.invoke("feature",new JSONArray().put("mobile.sync-delete").put(new JSONObject().put("path",note).put("root","internal").put("expected","stale")));fail("stale deletion must fail");}catch(VaultStore.Conflict correct){}
            bridge.invoke("feature",new JSONArray().put("mobile.sync-delete").put(new JSONObject().put("path",note).put("root","internal").put("expected",expected)));assertFalse(bridge.vault.exists(note));assertTrue(bridge.vault.exists(asset));
            bridge.vault.create(note,"file","old");byte[] raw=new byte[]{0,(byte)255,(byte)128,13,10};
            Object version=bridge.invoke("feature",new JSONArray().put("mobile.write-bytes").put(new JSONObject().put("root","internal").put("path",note).put("expected",bridge.vault.hash(note)).put("base64",android.util.Base64.encodeToString(raw,android.util.Base64.NO_WRAP))));
            assertArrayEquals(raw,bridge.vault.bytes(note));assertEquals(VaultPaths.hash(raw),version);assertEquals(VaultPaths.hash(raw),bridge.vault.hash(note));
            try{bridge.invoke("feature",new JSONArray().put("mobile.webdav-config").put(new JSONObject().put("root","wrong-vault")));fail("must not read another vault connection");}catch(java.io.IOException correct){}
        }finally{if(bridge.vault.exists(folder))bridge.vault.delete(folder);bridge.io.shutdown();instrumentation.runOnMainSync(activity::finish);}
    }
    @Test public void testSaveConflictHistoryAndAttachmentRoundTrip() throws Exception {
        VaultStore store=new VaultStore(InstrumentationRegistry.getInstrumentation().getTargetContext());store.select(null);
        String note="android-qa.md",attachment="android-qa.assets/attachments/image.svg";
        try {
            if(store.exists(note))store.delete(note);
            JSONObject original=store.create(note,"file","# 原文\n\n第一行\n第二行");
            assertEquals(new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"vault/"+note).getCanonicalPath(),store.location(note));
            JSONObject saved=store.save(note,"# 修改\n\n__下划线__",original.getString("version"));
            assertEquals("# 修改\n\n__下划线__",store.read(note).getString("content"));
            assertFalse(original.getString("version").equals(saved.getString("version")));
            try{store.save(note,"错误覆盖",original.getString("version"));fail("must reject stale save");}catch(VaultStore.Conflict expected){assertEquals(saved.getString("version"),expected.current.getString("version"));}
            assertEquals(saved.getString("content"),store.read(note).getString("content"));
            store.history.record(store.root(),note,saved.getString("content"),true);JSONArray entries=store.history.list(store.root(),note);assertTrue(entries.length()>=2);
            assertEquals(saved.getString("content"),store.history.read(store.root(),note,entries.getJSONObject(0).getString("id")));
            byte[] image="<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8);store.write(attachment,image,true);assertEquals(new String(image,StandardCharsets.UTF_8),new String(store.bytes(attachment),StandardCharsets.UTF_8));
            store.draft(note,new JSONObject().put("root",store.root()).put("path",note).put("content","恢复内容").put("version",saved.getString("version")));assertTrue(store.drafts().length()>0);store.clearDraft(note);
        }finally{if(store.exists(note))store.delete(note);if(store.exists("android-qa.assets"))store.delete("android-qa.assets");}
    }
}
