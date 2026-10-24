package app.moyu.notes;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.function.LongSupplier;

final class HistoryStore extends SQLiteOpenHelper {
    private final LongSupplier clock;
    private final LinkedHashMap<String,Long> leases=new LinkedHashMap<>();
    private long nextPrune;
    HistoryStore(Context context) { this(context,System::currentTimeMillis); }
    HistoryStore(Context context,LongSupplier clock) { super(context, "history.sqlite", null, 2);this.clock=clock; }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE snapshots(id INTEGER PRIMARY KEY, vault TEXT NOT NULL, path TEXT NOT NULL, time INTEGER NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL)");
        db.execSQL("CREATE INDEX snapshot_path ON snapshots(vault,path,time)");
        db.execSQL("CREATE INDEX snapshot_time ON snapshots(time)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { if(oldVersion<2)db.execSQL("CREATE INDEX IF NOT EXISTS snapshot_time ON snapshots(time)"); }
    private void lease(String key,long time){leases.remove(key);leases.put(key,time);while(leases.size()>256)leases.remove(leases.keySet().iterator().next());}
    synchronized void record(String vault, String path, String content, boolean force) {
        long now=clock.getAsLong();String key=vault+"\n"+path;Long leased=leases.get(key);
        if(!force&&leased!=null&&now>=leased&&now-leased<60000)return;
        SQLiteDatabase db = getWritableDatabase(); String hash = VaultPaths.hash(content);
        try (Cursor last = db.rawQuery("SELECT hash,time FROM snapshots WHERE vault=? AND path=? ORDER BY id DESC LIMIT 1", new String[]{vault,path})) {
            if (last.moveToFirst()) {long time=last.getLong(1);if(hash.equals(last.getString(0))||(!force&&now>=time&&now-time<60000)){lease(key,hash.equals(last.getString(0))?now:time);return;}}
        }
        ContentValues values = new ContentValues(); values.put("vault",vault); values.put("path",path); values.put("time",now); values.put("hash",hash); values.put("content",content);
        boolean prune=now>=nextPrune||nextPrune-now>3600000;
        db.beginTransaction();try{
            db.insertOrThrow("snapshots",null,values);
            if(prune)db.execSQL("DELETE FROM snapshots WHERE time < ?", new Object[]{now-30L*86400000});
            db.execSQL("DELETE FROM snapshots WHERE vault=? AND path=? AND id NOT IN (SELECT id FROM snapshots WHERE vault=? AND path=? ORDER BY id DESC LIMIT 100)",new Object[]{vault,path,vault,path});
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        if(prune)nextPrune=now+3600000;lease(key,now);
    }
    synchronized JSONArray list(String vault,String path) throws Exception {
        JSONArray result = new JSONArray();
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT id,time,length(CAST(content AS BLOB)) FROM snapshots WHERE vault=? AND path=? AND time>=? ORDER BY id DESC LIMIT 100",new String[]{vault,path,String.valueOf(clock.getAsLong()-30L*86400000)})) {
            while(cursor.moveToNext())result.put(new JSONObject().put("id",String.valueOf(cursor.getLong(0))).put("time",cursor.getLong(1)).put("bytes",cursor.getLong(2)).put("reason","saved"));
        } return result;
    }
    synchronized String read(String vault,String path,String id) throws Exception {
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT content FROM snapshots WHERE vault=? AND path=? AND id=? AND time>=?",new String[]{vault,path,id,String.valueOf(clock.getAsLong()-30L*86400000)})) {
            if(!cursor.moveToFirst())throw new IllegalArgumentException("历史记录不存在。");return cursor.getString(0);
        }
    }
    synchronized void move(String vault,String from,String to) {
        leases.clear();
        SQLiteDatabase db=getWritableDatabase();
        try(Cursor cursor=db.rawQuery("SELECT DISTINCT path FROM snapshots WHERE vault=?",new String[]{vault})) {
            while(cursor.moveToNext()){String old=cursor.getString(0),next=VaultPaths.remap(old,from,to);if(!old.equals(next)){ContentValues values=new ContentValues();values.put("path",next);db.update("snapshots",values,"vault=? AND path=?",new String[]{vault,old});}}
        }
    }
}
