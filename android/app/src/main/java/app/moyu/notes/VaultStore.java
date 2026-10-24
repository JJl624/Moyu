package app.moyu.notes;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import android.webkit.MimeTypeMap;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** All filesystem operations are serialized by NativeBridge; SAF and private files have one contract. */
final class VaultStore {
    static final String DIRECTORY=DocumentsContract.Document.MIME_TYPE_DIR;
    final Context context;
    final HistoryStore history;
    private final File home;
    private final ContentResolver resolver;
    private Uri tree;
    private final LinkedHashMap<String,String> draftHashes=new LinkedHashMap<>();
    VaultStore(Context context) throws Exception {
        this.context=context;resolver=context.getContentResolver();home=new File(context.getFilesDir(),"vault");
        if(!home.isDirectory()&&!home.mkdirs())throw new IOException("无法创建知识库。");
        history=new HistoryStore(context);
        String saved=context.getSharedPreferences("workspace",0).getString("tree","");tree=saved.isEmpty()?null:Uri.parse(saved);
        if(!new File(home,"开始使用.md").exists()) {
            try(InputStream source=context.getAssets().open("guides/开始使用.md")){writePrivate(new File(home,"开始使用.md"),readBytes(source));}
        }
    }
    synchronized String root(){return tree==null?"internal":tree.toString();}
    synchronized String location(String path) throws Exception {return tree==null?privateFile(path).getCanonicalPath():uri(path,false).toString();}
    synchronized void select(Uri uri) throws Exception {
        Uri previous=tree;tree=uri;
        try{list();}catch(Exception error){tree=previous;throw error;}
        context.getSharedPreferences("workspace",0).edit().putString("tree",uri==null?"":uri.toString()).commit();
    }
    private File privateFile(String path) throws IOException {
        File file=new File(home,VaultPaths.checked(path));
        if(!file.getCanonicalPath().startsWith(home.getCanonicalPath()+File.separator))throw new IOException("文件不在知识库中。");
        return file;
    }
    private Uri rootDocument(){return DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));}
    private List<JSONObject> children(Uri parent,String prefix) throws Exception {
        List<JSONObject> result=new ArrayList<>();
        Uri query=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_LAST_MODIFIED,DocumentsContract.Document.COLUMN_SIZE};
        try(Cursor cursor=resolver.query(query,columns,null,null,null)) {
            if(cursor==null)throw new IOException("无法读取文件夹，请重新选择知识库。");
            while(cursor.moveToNext()) {
                String name=cursor.getString(1);try{VaultPaths.checked(name);}catch(IllegalArgumentException error){continue;}
                result.add(new JSONObject().put("path",prefix+name).put("name",name).put("kind",DIRECTORY.equals(cursor.getString(2))?"folder":"file").put("updated",cursor.getLong(3)).put("size",cursor.getLong(4)).put("uri",DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0)).toString()));
            }
        }return result;
    }
    private Uri uri(String path,boolean createParents) throws Exception {
        if(path.isEmpty())return rootDocument();VaultPaths.checked(path);
        Uri current=rootDocument();String prefix="";
        for(String part:path.split("/")) {
            Uri next=null;
            for(JSONObject node:children(current,prefix))if(part.equals(node.getString("name"))){next=Uri.parse(node.getString("uri"));break;}
            if(next==null&&createParents)next=createDocument(current,DIRECTORY,part);
            if(next==null)throw new FileNotFoundException("文件不存在："+path);
            current=next;prefix+=part+"/";
        }return current;
    }
    synchronized boolean exists(String path) {
        try{return tree==null?privateFile(path).exists():uri(path,false)!=null;}catch(Exception error){return false;}
    }
    private JSONArray scan(String prefix,int depth,int[] count) throws Exception {
        if(depth>40||count[0]>50000)throw new IOException("知识库目录过多，请选择较小的文件夹。");
        List<JSONObject> nodes=new ArrayList<>();
        if(tree==null) {
            File folder=prefix.isEmpty()?home:privateFile(prefix.substring(0,prefix.length()-1));File[] files=folder.listFiles();
            if(files==null)throw new IOException("无法读取知识库。");
            for(File file:files){try{VaultPaths.checked(file.getName());}catch(IllegalArgumentException ignored){continue;}
                nodes.add(new JSONObject().put("path",prefix+file.getName()).put("name",file.getName()).put("kind",file.isDirectory()?"folder":"file").put("updated",file.lastModified()).put("size",file.isFile()?file.length():0));}
        }else nodes=children(uri(prefix.isEmpty()?"":prefix.substring(0,prefix.length()-1),false),prefix);
        nodes.sort((a,b)->{boolean af="folder".equals(a.optString("kind")),bf="folder".equals(b.optString("kind"));return af!=bf?(af?-1:1):a.optString("name").compareToIgnoreCase(b.optString("name"));});
        JSONArray result=new JSONArray();
        for(JSONObject node:nodes){count[0]++;node.remove("uri");if("folder".equals(node.getString("kind")))node.put("children",scan(node.getString("path")+"/",depth+1,count));result.put(node);}
        return result;
    }
    synchronized JSONObject list() throws Exception {
        String name="我的知识库";
        if(tree!=null)try(Cursor cursor=resolver.query(rootDocument(),new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}
        return new JSONObject().put("root",root()).put("name",name).put("tree",scan("",0,new int[]{0}));
    }
    synchronized InputStream open(String path) throws Exception {
        if(tree==null)return new AtomicFile(privateFile(path)).openRead();
        InputStream input=resolver.openInputStream(uri(path,false));if(input==null)throw new IOException("无法打开文件。");return input;
    }
    static byte[] readBytes(InputStream input) throws IOException {ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[32768];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toByteArray();}
    synchronized byte[] bytes(String path) throws Exception {try(InputStream input=open(path)){return readBytes(input);}}
    synchronized String hash(String path) throws Exception {try(InputStream input=open(path)){java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[32768];int count;while((count=input.read(buffer))!=-1)digest.update(buffer,0,count);StringBuilder result=new StringBuilder();for(byte value:digest.digest())result.append(String.format("%02x",value));return result.toString();}}
    synchronized JSONObject read(String path) throws Exception {
        byte[] bytes=bytes(path);long modified=0;
        if(tree==null)modified=privateFile(path).lastModified();
        else try(Cursor cursor=resolver.query(uri(path,false),new String[]{DocumentsContract.Document.COLUMN_LAST_MODIFIED},null,null,null)){if(cursor!=null&&cursor.moveToFirst())modified=cursor.getLong(0);}
        return new JSONObject().put("path",path).put("content",new String(bytes,StandardCharsets.UTF_8)).put("version",VaultPaths.hash(bytes)).put("updated",modified);
    }
    static void writePrivate(File file,byte[] bytes) throws IOException {
        File parent=file.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("无法创建文件夹。");
        AtomicFile target=new AtomicFile(file);FileOutputStream output=null;
        try{output=target.startWrite();output.write(bytes);target.finishWrite(output);}catch(IOException error){if(output!=null)target.failWrite(output);throw error;}
    }
    private Uri createDocument(Uri parent,String type,String name) throws Exception {
        Uri created=DocumentsContract.createDocument(resolver,parent,type,name);
        if(created==null)throw new IOException("无法创建文件。");
        try(Cursor cursor=resolver.query(created,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(cursor==null||!cursor.moveToFirst()||!name.equals(cursor.getString(0))){DocumentsContract.deleteDocument(resolver,created);throw new IOException("文件名已被存储服务更改，请使用其他名称。");}
        }return created;
    }
    synchronized void write(String path,byte[] bytes,boolean create) throws Exception {
        VaultPaths.checked(path);
        if(tree==null){File file=privateFile(path);if(!create&&!file.isFile())throw new FileNotFoundException(path);writePrivate(file,bytes);return;}
        Uri target;
        if(exists(path))target=uri(path,false);
        else{if(!create)throw new FileNotFoundException(path);target=createDocument(uri(VaultPaths.parent(path),true),mime(path),VaultPaths.name(path));}
        if(target==null)throw new IOException("无法创建文件。");
        try(OutputStream output=resolver.openOutputStream(target,"wt")){if(output==null)throw new IOException("无法保存文件。");output.write(bytes);output.flush();}
    }
    synchronized JSONObject save(String path,String content,String expected) throws Exception {
        JSONObject before=read(path);
        if(!before.getString("version").equals(expected))throw new Conflict(before);
        if(before.getString("content").equals(content)){clearDraft(path);return before;}
        history.record(root(),path,before.getString("content"),false);
        JSONObject recovery=new JSONObject().put("root",root()).put("path",path).put("content",content).put("version",expected);
        draft(path,recovery);
        write(path,content.getBytes(StandardCharsets.UTF_8),false);
        JSONObject saved=read(path);
        if(!saved.getString("content").equals(content))throw new IOException("保存后校验失败，修改内容已保留。");
        history.record(root(),path,content,false);clearDraft(path);return saved;
    }
    synchronized JSONObject create(String path,String kind,String content) throws Exception {
        VaultPaths.checked(path);if(exists(path))throw new IOException("这个名称已经存在。");
        if("folder".equals(kind)){
            if(tree==null){if(!privateFile(path).mkdirs())throw new IOException("无法创建文件夹。");}
            else createDocument(uri(VaultPaths.parent(path),true),DIRECTORY,VaultPaths.name(path));
            return new JSONObject().put("path",path).put("content","").put("version","").put("updated",System.currentTimeMillis());
        }
        write(path,content.getBytes(StandardCharsets.UTF_8),true);return read(path);
    }
    synchronized void move(String from,String to) throws Exception {
        VaultPaths.checked(from);VaultPaths.checked(to);
        if(from.equals(to))return;if(to.startsWith(from+"/"))throw new IOException("不能移入自身的子文件夹。");
        if(exists(to))throw new IOException("目标名称已经存在。");
        if(tree==null){File target=privateFile(to);if(!target.getParentFile().isDirectory())throw new IOException("目标文件夹不存在。");if(!privateFile(from).renameTo(target))throw new IOException("移动失败。");}
        else{
            Uri target=uri(from,false);boolean moved=!VaultPaths.parent(from).equals(VaultPaths.parent(to));
            if(moved){target=DocumentsContract.moveDocument(resolver,target,uri(VaultPaths.parent(from),false),uri(VaultPaths.parent(to),false));if(target==null)throw new IOException("此存储位置不支持移动文件。");}
            try{if(!VaultPaths.name(from).equals(VaultPaths.name(to))&&DocumentsContract.renameDocument(resolver,target,VaultPaths.name(to))==null)throw new IOException("重命名失败。");}
            catch(Exception error){if(moved)try{if(DocumentsContract.moveDocument(resolver,target,uri(VaultPaths.parent(to),false),uri(VaultPaths.parent(from),false))==null)throw new IOException("无法恢复原位置。");}catch(Exception rollback){throw new IOException("重命名未完成，文件位于目标文件夹，名称仍为："+VaultPaths.name(from),rollback);}throw error;}
        }
        history.move(root(),from,to);
    }
    synchronized void delete(String path) throws Exception {
        if(tree==null)deletePrivate(privateFile(path));else if(!DocumentsContract.deleteDocument(resolver,uri(path,false)))throw new IOException("无法删除文件。");
    }
    static void deletePrivate(File file) throws IOException {
        if(file.isDirectory()){File[] children=file.listFiles();if(children==null)throw new IOException("无法读取目录。");for(File child:children)deletePrivate(child);}
        if(file.exists()&&!file.delete())throw new IOException("无法删除文件。");
    }
    private File draftFile(String path){return new File(context.getFilesDir(),"drafts/"+VaultPaths.hash(root()+"\n"+path)+".json");}
    synchronized void draft(String path,JSONObject value) throws Exception {
        VaultPaths.checked(path);File file=draftFile(path);byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);String key=file.getName(),hash=VaultPaths.hash(bytes);
        if(hash.equals(draftHashes.get(key))&&file.isFile())return;
        writePrivate(file,bytes);draftHashes.remove(key);draftHashes.put(key,hash);while(draftHashes.size()>256)draftHashes.remove(draftHashes.keySet().iterator().next());
    }
    synchronized void clearDraft(String path) throws IOException {File file=draftFile(path);if(file.exists()&&!file.delete())throw new IOException("无法移除恢复草稿。");draftHashes.remove(file.getName());}
    synchronized JSONArray drafts() throws Exception {
        JSONArray result=new JSONArray();File[] files=new File(context.getFilesDir(),"drafts").listFiles();if(files==null)return result;
        for(File file:files)try{JSONObject draft=new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));if(root().equals(draft.optString("root")))result.put(draft);}catch(Exception ignored){}
        return result;
    }
    static String mime(String path){String extension=path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);String type=MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);return type!=null?type:(extension.equals("md")?"text/markdown":"application/octet-stream");}
    static final class Conflict extends IOException {final JSONObject current;Conflict(JSONObject current){super("文件已被其他应用修改，请选择保留的内容。");this.current=current;}}
}
