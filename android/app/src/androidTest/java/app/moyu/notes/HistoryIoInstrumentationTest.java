package app.moyu.notes;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.File;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

@RunWith(AndroidJUnit4.class)
public class HistoryIoInstrumentationTest {
    @Test public void historyThrottlesAndPrunesWithoutLosingForcedVersionsOrFailedWrites() throws Exception {
        AtomicLong clock=new AtomicLong(1700000000000L);String vault="history-io-"+System.nanoTime();
        HistoryStore store=new HistoryStore(InstrumentationRegistry.getInstrumentation().getTargetContext(),clock::get);SQLiteDatabase db=store.getWritableDatabase();
        try{
            store.record(vault,"a.md","original",false);for(int i=0;i<100;i++)store.record(vault,"a.md","typing "+i,false);assertEquals(1,store.list(vault,"a.md").length());
            store.record(vault,"a.md","forced",true);assertEquals("forced",store.read(vault,"a.md",store.list(vault,"a.md").getJSONObject(0).getString("id")));
            clock.addAndGet(60000);store.record(vault,"a.md","later",false);assertEquals(3,store.list(vault,"a.md").length());
            db.execSQL("CREATE TEMP TRIGGER reject_io_history BEFORE INSERT ON snapshots WHEN NEW.vault='"+vault+"' AND NEW.path='failure.md' BEGIN SELECT RAISE(ABORT,'test failure'); END");
            try{store.record(vault,"failure.md","retry",false);fail("write must fail");}catch(android.database.sqlite.SQLiteException expected){}finally{db.execSQL("DROP TRIGGER reject_io_history");}
            store.record(vault,"failure.md","retry",false);assertEquals(1,store.list(vault,"failure.md").length());
            ContentValues expired=new ContentValues();expired.put("vault",vault);expired.put("path","expired.md");expired.put("time",clock.get()-31L*86400000);expired.put("hash","old");expired.put("content","old");db.insertOrThrow("snapshots",null,expired);
            store.record(vault,"b.md","before prune",false);assertEquals(0,store.list(vault,"expired.md").length());
            try(Cursor count=db.rawQuery("SELECT count(*) FROM snapshots WHERE vault=? AND path='expired.md'",new String[]{vault})){assertTrue(count.moveToFirst());assertEquals(1,count.getInt(0));}
            clock.addAndGet(3600000);store.record(vault,"b.md","after prune",false);
            try(Cursor count=db.rawQuery("SELECT count(*) FROM snapshots WHERE vault=? AND path='expired.md'",new String[]{vault})){assertTrue(count.moveToFirst());assertEquals(0,count.getInt(0));}
            store.move(vault,"a.md","moved.md");assertEquals(3,store.list(vault,"moved.md").length());
        }finally{db.delete("snapshots","vault=?",new String[]{vault});store.close();}
    }
    @Test public void unchangedSaveLeavesTheFileAndHistoryUntouchedButStillRejectsAStaleVersion() throws Exception {
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();VaultStore store=new VaultStore(context);store.select(null);String name="io-save-"+System.nanoTime()+".md";
        try{
            JSONObject original=store.create(name,"file","unchanged");File file=new File(context.getFilesDir(),"vault/"+name);long modified=file.lastModified();
            store.save(name,"unchanged",original.getString("version"));assertEquals(modified,file.lastModified());assertEquals(0,store.history.list(store.root(),name).length());
            JSONObject draft=new JSONObject().put("root",store.root()).put("path",name).put("content","draft").put("version",original.getString("version"));store.draft(name,draft);
            File recovery=new File(context.getFilesDir(),"drafts/"+VaultPaths.hash(store.root()+"\n"+name)+".json");assertTrue(recovery.setLastModified(1000000000000L));store.draft(name,draft);assertEquals(1000000000000L,recovery.lastModified());
            store.clearDraft(name);store.draft(name,draft);assertTrue(recovery.isFile());store.clearDraft(name);
            try{store.save(name,"unchanged","wrong version");fail("version check must precede the no-op optimization");}catch(VaultStore.Conflict expected){}
        }finally{store.delete(name);store.history.close();}
    }
}
