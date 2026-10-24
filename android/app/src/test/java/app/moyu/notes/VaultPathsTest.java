package app.moyu.notes;
import org.junit.Test;
import static org.junit.Assert.*;

public class VaultPathsTest {
    @Test public void portablePathsKeepUnicodeAndRejectEscapesAndDeviceNames(){
        assertEquals("笔记/计划 (1).md",VaultPaths.checked("笔记/计划 (1).md"));
        for(String path:new String[]{"../secret","/outside.md","a//b","a/./b","a/../b",".data/settings","a\\b","CON.md","a/NUL","a:b","a/file. ","a/\u0000b"}){
            try{VaultPaths.checked(path);fail(path);}catch(IllegalArgumentException expected){}
        }
    }
    @Test public void remappingDoesNotChangeSimilarlyNamedSibling(){
        assertEquals("new/a.md",VaultPaths.remap("old/a.md","old","new"));
        assertEquals("older/a.md",VaultPaths.remap("older/a.md","old","new"));
        assertEquals("a",VaultPaths.parent("a/b.md"));assertEquals("b.md",VaultPaths.name("a/b.md"));
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",VaultPaths.hash("abc"));
    }
}
