package app.moyu.notes;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Portable vault paths, independent of Android and of the selected storage provider. */
public final class VaultPaths {
    private VaultPaths() {}
    public static String checked(String value) {
        if (value == null || value.isEmpty() || value.startsWith("/") || value.length() > 4096)
            throw new IllegalArgumentException("文件路径无效。");
        for (String part : value.split("/", -1)) {
            if (part.isEmpty() || part.startsWith(".") || part.equals("node_modules") || part.endsWith(" ")
                    || part.endsWith(".")
                    || part.matches("(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\..*)?"))
                throw new IllegalArgumentException("文件名不能包含路径分隔符或保留字符。");
            for (char c : part.toCharArray()) if (c < 32 || "<>:\"\\|?*".indexOf(c) >= 0)
                throw new IllegalArgumentException("文件名包含无效字符。");
        }
        return value;
    }
    public static String parent(String value) { int i = value.lastIndexOf('/'); return i < 0 ? "" : value.substring(0, i); }
    public static String name(String value) { return value.substring(value.lastIndexOf('/') + 1); }
    public static String remap(String value, String from, String to) {
        return value.equals(from) || value.startsWith(from + "/") ? to + value.substring(from.length()) : value;
    }
    public static String hash(byte[] bytes) {
        try {
            byte[] result = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder text = new StringBuilder();
            for (byte b : result) text.append(String.format("%02x", b));
            return text.toString();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    public static String hash(String text) { return hash(text.getBytes(StandardCharsets.UTF_8)); }
}
