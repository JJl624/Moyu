package app.moyu.notes;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.util.Base64;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Origin-checked async RPC. Document and settings writes share one ordered I/O queue. */
final class NativeBridge {
    final MainActivity activity;
    final ExecutorService io=Executors.newSingleThreadExecutor();
    VaultStore vault;
    private JSONObject settings;
    private boolean recovered;
    NativeBridge(MainActivity activity){this.activity=activity;}
    void request(String message,JavaScriptReplyProxy proxy) {
        String responseId="";
        try {
            JSONObject request=new JSONObject(message);String id=request.getString("id"),method=request.getString("method");JSONArray args=request.optJSONArray("args");
            responseId=id;
            if(args==null)args=new JSONArray();final JSONArray values=args;
            if(activity.dispatchPicker(method,values,(value,error)->reply(proxy,id,value,error)))return;
            io.execute(()->{try{initialize();Object result=invoke(method,values);reply(proxy,id,result,null);}catch(Exception error){reply(proxy,id,null,error);}});
        }catch(Exception error){if(!responseId.isEmpty())reply(proxy,responseId,null,error);}
    }
    synchronized void initialize() throws Exception {
        if(vault==null)vault=new VaultStore(activity);
        if(!recovered){recoverRelocation();recovered=true;}
        if(settings==null){File file=new File(activity.getFilesDir(),"settings.json");settings=file.isFile()?new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8)):new JSONObject();}
    }
    void reply(JavaScriptReplyProxy proxy,String id,Object value,Exception error) {
        try{
            JSONObject response=new JSONObject().put("id",id).put("ok",error==null);
            if(error==null)response.put("data",value==null?JSONObject.NULL:value);
            else {JSONObject failure=new JSONObject().put("message",error.getMessage()==null?"操作失败。":error.getMessage());if(error instanceof VaultStore.Conflict)failure.put("code","CONFLICT").put("current",((VaultStore.Conflict)error).current);response.put("error",failure);}
            activity.deliver(proxy,response.toString());
        }catch(Exception ignored){}
    }
    Object invoke(String method,JSONArray args) throws Exception {
        switch(method){
            case "load":case "list":return vault.list();
            case "read":return vault.read(args.getString(0));
            case "save":{
                String root=args.optString(3,"");if(!root.isEmpty()&&!root.equals(vault.root()))throw new IOException("知识库已切换。");
                return vault.save(args.getString(0),args.getString(1),args.getString(2));
            }
            case "create":return vault.create(args.getString(0),args.getString(1),args.optString(2,""));
            case "rename":vault.move(args.getString(0),args.getString(1));return new JSONObject().put("path",args.getString(1));
            case "trash":return trash(args.getString(0));
            case "search":return search(args.getString(0));
            case "feature":return feature(args.getString(0),args.optJSONObject(1)==null?new JSONObject():args.getJSONObject(1));
            default:throw new IOException("不支持此操作："+method);
        }
    }
    private void saveSettings() throws Exception {VaultStore.writePrivate(new File(activity.getFilesDir(),"settings.json"),settings.toString().getBytes(StandardCharsets.UTF_8));}
    private Object feature(String action,JSONObject input) throws Exception {
        if(action.startsWith("mobile.")&&input.has("root")&&!vault.root().equals(input.getString("root")))throw new IOException("知识库已切换。");
        switch(action){
            case "preferences.get":return settings;
            case "preferences.set-many":{
                JSONObject values=input.getJSONObject("values");boolean changed=false;Iterator<String> keys=values.keys();while(keys.hasNext()){String key=keys.next();Object value=values.get(key);if(!Objects.equals(settings.opt(key),value)){settings.put(key,value);changed=true;}}if(changed)saveSettings();return true;
            }
            case "mobile.internal-vault":vault.select(null);recoverRelocation();return vault.list();
            case "mobile.drafts":return vault.drafts();
            case "mobile.draft":if(!vault.root().equals(input.optString("root")))throw new IOException("知识库已切换。");vault.draft(input.getString("path"),input);return true;
            case "mobile.draft-clear":vault.clearDraft(input.getString("path"));return true;
            case "mobile.read-bytes":{byte[] bytes=vault.bytes(input.getString("path"));return new JSONObject().put("base64",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("hash",VaultPaths.hash(bytes)).put("size",bytes.length);}
            case "mobile.file-location":return vault.location(input.getString("path"));
            case "mobile.file-hashes":{JSONObject result=new JSONObject();JSONArray paths=input.getJSONArray("paths");if(paths.length()>50000)throw new IOException("文件数量过多。");for(int i=0;i<paths.length();i++){String path=paths.getString(i);try{result.put(path,vault.hash(path));}catch(FileNotFoundException ignored){}}return result;}
            case "mobile.sync-delete":{String path=input.getString("path");if(!vault.hash(path).equals(input.getString("expected")))throw new VaultStore.Conflict(vault.read(path));return trash(path,false);}
            case "mobile.write-bytes":{
                byte[] bytes=Base64.decode(input.getString("base64"),Base64.DEFAULT);String path=input.getString("path");
                if(input.has("expected")){String current=vault.hash(path);if(!current.equals(input.getString("expected")))throw new VaultStore.Conflict(vault.read(path));}
                else if(vault.exists(path))throw new IOException("文件已存在，请刷新后重试。");
                String text=new String(bytes,StandardCharsets.UTF_8);
                if(input.has("expected")&&path.matches("(?i).*\\.(md|markdown|txt|html|json|csv|excalidraw)$")&&Arrays.equals(bytes,text.getBytes(StandardCharsets.UTF_8)))vault.save(path,text,input.getString("expected"));
                else vault.write(path,bytes,!input.has("expected"));String saved=vault.hash(path);if(!saved.equals(VaultPaths.hash(bytes)))throw new IOException("下载后文件校验失败："+path);return saved;
            }
            case "mobile.trash-list":return trashList();
            case "mobile.trash-restore":return restoreTrash(input.getString("id"));
            case "mobile.relocate":return relocate(input);
            case "file.exists":return vault.exists(input.getString("path"));
            case "drawing.read":return vault.read(input.getString("path"));
            case "drawing.save":return vault.save(input.getString("path"),input.getString("content"),input.getString("version"));
            case "file.binary-read":return new JSONObject().put("path",input.getString("path")).put("content","").put("version",vault.hash(input.getString("path"))).put("updated",0);
            case "code.counter":return new JSONObject().put("next",1);
            case "code.normalize":return new JSONObject().put("content",input.optString("content"));
            case "file.history-list":return new JSONObject().put("enabled",true).put("entries",vault.history.list(vault.root(),input.getString("document"))).put("interval",60).put("retentionDays",30).put("limit",100).put("maxText",0);
            case "file.history-read":case "file.history-restore":return new JSONObject().put("content",vault.history.read(vault.root(),input.getString("document"),input.getString("id")));
            case "file.history-capture":vault.history.record(vault.root(),input.getString("document"),input.getString("content"),true);return true;
            case "mobile.webdav-config":{
                File file=new File(activity.getFilesDir(),"webdav.json");
                JSONObject stored=file.exists()?new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8)):new JSONObject();String key=VaultPaths.hash(vault.root());
                JSONObject connections=stored.optJSONObject("connections");boolean migrated=false;if(connections==null){connections=new JSONObject();if(!stored.optString("url").isEmpty()){connections.put(key,stored);migrated=true;}}
                if(input.has("config"))connections.put(key,input.getJSONObject("config"));
                if(input.has("config")||migrated)VaultStore.writePrivate(file,new JSONObject().put("connections",connections).toString().getBytes(StandardCharsets.UTF_8));
                if(input.has("config"))return true;JSONObject config=connections.optJSONObject(key);return config==null?new JSONObject():config;
            }
            case "mobile.webdav-request":return new WebDavTransport().request(input);
            case "clipboard.write":activity.runOnUiThread(()->{ClipboardManager clipboard=(ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE);clipboard.setPrimaryClip(ClipData.newPlainText("",input.optString("text")));});return true;
            case "attachment.upload":return attachment(input.getString("document"),input.getString("name"),Base64.decode(input.getString("base64"),Base64.DEFAULT));
            default:throw new IOException("安卓版尚未提供此操作："+action);
        }
    }
    JSONObject attachment(String document,String name,byte[] bytes) throws Exception {
        VaultPaths.checked(document);VaultPaths.checked(name);if(name.contains("/"))throw new IOException("附件名不能包含文件夹。");
        String stem=document.replaceFirst("(?i)\\.(md|markdown)$","");String base=stem+".assets/attachments/"+name,path=base;int suffix=1;
        while(vault.exists(path)){int dot=name.lastIndexOf('.');String next=dot>0?name.substring(0,dot)+" ("+suffix+++")"+name.substring(dot):name+" ("+suffix+++")";path=stem+".assets/attachments/"+next;}
        vault.write(path,bytes,true);return new JSONObject().put("path",path).put("name",VaultPaths.name(path));
    }
    private JSONArray search(String query) throws Exception {
        JSONArray result=new JSONArray();String needle=query.toLowerCase(Locale.ROOT).trim();if(needle.isEmpty())return result;
        for(JSONObject file:flatten(vault.list().getJSONArray("tree"))) {
            String path=file.getString("path");JSONArray matches=new JSONArray();
            if(path.matches("(?i).*\\.(md|markdown|txt|html|json|csv)$"))try{String[] lines=vault.read(path).getString("content").split("\n",-1);for(int i=0;i<lines.length&&matches.length()<5;i++)if(lines[i].toLowerCase(Locale.ROOT).contains(needle))matches.put(new JSONObject().put("text",lines[i]).put("line",i+1));}catch(IOException ignored){}
            if(path.toLowerCase(Locale.ROOT).contains(needle)||matches.length()>0)result.put(new JSONObject().put("path",path).put("name",file.getString("name")).put("matches",matches));
            if(result.length()>=200)break;
        }return result;
    }
    static List<JSONObject> flatten(JSONArray nodes) throws Exception {
        List<JSONObject> result=new ArrayList<>();for(int i=0;i<nodes.length();i++){JSONObject node=nodes.getJSONObject(i);if("folder".equals(node.getString("kind")))result.addAll(flatten(node.getJSONArray("children")));else result.add(node);}return result;
    }
    private JSONObject trash(String path) throws Exception {
        return trash(path,true);
    }
    private JSONObject trash(String path,boolean includeCompanion) throws Exception {
        VaultPaths.checked(path);String id=UUID.randomUUID().toString();File target=new File(activity.getFilesDir(),"trash/"+id);if(!target.mkdirs())throw new IOException("无法创建回收站。");
        JSONArray entries=new JSONArray(),folders=new JSONArray(),targets=new JSONArray().put(path);JSONObject listing=vault.list();
        String companion=path.replaceFirst("(?i)\\.(md|markdown)$","")+".assets";
        if(includeCompanion&&path.matches("(?i).*\\.(md|markdown)$")&&vault.exists(companion))targets.put(companion);
        collectTrashFolders(listing.getJSONArray("tree"),targets,folders);
        for(JSONObject file:flatten(listing.getJSONArray("tree"))) {
            String name=file.getString("path");if(selectedTrashPath(name,targets)){byte[] bytes=vault.bytes(name);String key=String.valueOf(entries.length());VaultStore.writePrivate(new File(target,key),bytes);entries.put(new JSONObject().put("path",name).put("key",key));}
        }
        JSONObject receipt=new JSONObject().put("id",id).put("root",vault.root()).put("path",path).put("time",System.currentTimeMillis()).put("entries",entries).put("folders",folders).put("targets",targets);
        VaultStore.writePrivate(new File(target,"receipt.json"),receipt.toString().getBytes(StandardCharsets.UTF_8));
        for(int i=0;i<targets.length();i++)vault.delete(targets.getString(i));return vault.list();
    }
    private static boolean selectedTrashPath(String path,JSONArray targets) throws Exception {for(int i=0;i<targets.length();i++){String target=targets.getString(i);if(path.equals(target)||path.startsWith(target+"/"))return true;}return false;}
    private static void collectTrashFolders(JSONArray nodes,JSONArray targets,JSONArray result) throws Exception {for(int i=0;i<nodes.length();i++){JSONObject node=nodes.getJSONObject(i);if("folder".equals(node.getString("kind"))){if(selectedTrashPath(node.getString("path"),targets))result.put(node.getString("path"));collectTrashFolders(node.getJSONArray("children"),targets,result);}}}
    private JSONArray trashList() throws Exception {
        JSONArray result=new JSONArray();File[] dirs=new File(activity.getFilesDir(),"trash").listFiles();if(dirs==null)return result;
        for(File dir:dirs){File file=new File(dir,"receipt.json");if(!file.exists())continue;JSONObject receipt=new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));if(vault.root().equals(receipt.optString("root")))result.put(receipt);}
        return result;
    }
    private JSONObject restoreTrash(String id) throws Exception {
        if(!id.matches("[a-f0-9-]{36}"))throw new IOException("回收站条目无效。");File directory=new File(activity.getFilesDir(),"trash/"+id);
        JSONObject receipt=new JSONObject(new String(java.nio.file.Files.readAllBytes(new File(directory,"receipt.json").toPath()),StandardCharsets.UTF_8));
        if(!vault.root().equals(receipt.getString("root")))throw new IOException("请切换到原知识库。");
        JSONArray entries=receipt.getJSONArray("entries"),targets=receipt.getJSONArray("targets"),folders=receipt.getJSONArray("folders");
        for(int i=0;i<targets.length();i++)if(vault.exists(targets.getString(i)))throw new IOException("原位置已有同名文件，请先重命名。");
        for(int i=0;i<entries.length();i++)if(vault.exists(entries.getJSONObject(i).getString("path")))throw new IOException("原位置已有同名文件，请先重命名。");
        for(int i=0;i<folders.length();i++)vault.create(folders.getString(i),"folder","");
        for(int i=0;i<entries.length();i++){JSONObject item=entries.getJSONObject(i);vault.write(item.getString("path"),java.nio.file.Files.readAllBytes(new File(directory,item.getString("key")).toPath()),true);}
        VaultStore.deletePrivate(directory);return vault.list();
    }
    private JSONObject relocate(JSONObject input) throws Exception {
        if(!vault.root().equals(input.getString("root")))throw new IOException("知识库已切换。");
        File journal=new File(activity.getFilesDir(),"relocate-recovery.json");
        if(journal.exists())throw new IOException("有未完成的文件操作，请重启应用并打开原知识库以恢复。");
        JSONArray moves=input.getJSONArray("moves"),edits=input.getJSONArray("edits");
        for(int i=0;i<moves.length();i++){JSONObject move=moves.getJSONObject(i);VaultPaths.checked(move.getString("from"));VaultPaths.checked(move.getString("to"));if(vault.exists(move.getString("to")))throw new IOException("目标名称已经存在。");}
        for(int i=0;i<edits.length();i++){JSONObject edit=edits.getJSONObject(i);JSONObject current=vault.read(edit.getString("original"));if(!current.getString("version").equals(edit.getString("version")))throw new VaultStore.Conflict(current);edit.put("before",current.getString("content"));}
        VaultStore.writePrivate(journal,input.toString().getBytes(StandardCharsets.UTF_8));
        try{
            for(int i=0;i<moves.length();i++){JSONObject move=moves.getJSONObject(i);vault.move(move.getString("from"),move.getString("to"));}
            JSONArray documents=new JSONArray();
            for(int i=0;i<edits.length();i++){JSONObject edit=edits.getJSONObject(i);vault.write(edit.getString("path"),edit.getString("content").getBytes(StandardCharsets.UTF_8),false);documents.put(vault.read(edit.getString("path")));}
            journal.delete();return new JSONObject().put("moves",moves).put("documents",documents);
        }catch(Exception error){
            try{recoverRelocation();}catch(Exception recovery){throw new IOException("文件操作未完成，恢复副本已保留。"+error.getMessage(),recovery);}throw error;
        }
    }
    void recoverRelocation() throws Exception {
        File journal=new File(activity.getFilesDir(),"relocate-recovery.json");if(!journal.exists())return;
        JSONObject operation;try(InputStream stream=new android.util.AtomicFile(journal).openRead()){operation=new JSONObject(new String(VaultStore.readBytes(stream),StandardCharsets.UTF_8));}
        if(!vault.root().equals(operation.getString("root")))return;
        JSONArray moves=operation.getJSONArray("moves"),edits=operation.getJSONArray("edits");
        for(int i=moves.length()-1;i>=0;i--){JSONObject move=moves.getJSONObject(i);String from=move.getString("from"),to=move.getString("to");
            if(vault.exists(to)){if(vault.exists(from))throw new IOException("恢复文件操作时遇到同名文件，恢复副本已保留。");vault.move(to,from);}
            else if(!vault.exists(from))throw new IOException("恢复文件操作时找不到原文件，恢复副本已保留。");
        }
        for(int i=0;i<edits.length();i++){JSONObject edit=edits.getJSONObject(i);String original=edit.getString("original"),content=vault.read(original).getString("content");
            if(content.equals(edit.getString("before")))continue;
            if(!content.equals(edit.getString("content")))throw new IOException("恢复时发现文档已再次修改，恢复副本已保留。");
            vault.write(original,edit.getString("before").getBytes(StandardCharsets.UTF_8),false);
        }
        if(!journal.delete())throw new IOException("无法清除已完成的文件操作记录。");
    }
}
