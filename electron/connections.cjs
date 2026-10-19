const { hash, fault } = require("./vault.cjs");
const { policy } = require('./sync-policy.cjs');
function validateURL(value, optional = false) {
  if (!value && optional) return "";
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw fault("请输入不含用户名、密码和查询参数的 HTTP / HTTPS 地址。");
  return url.href.replace(/\/$/, "");
}
class Connections {
  constructor(directory, safeStorage) {
    this.directory = directory;
    this.store = new (require("./application-config.cjs").ApplicationConfig)(directory);
    this.safeStorage = safeStorage;
    this.queue = Promise.resolve();
  }
  file() { return this.store.file; }
  key(root) { return hash(root).slice(0, 24); }
  async get(root, reveal = false) {
    const all = await this.store.get('connections');
    return this.decode(all[this.key(root)] || {}, reveal);
  }
  decode(data, reveal) {
    for (const key of ["webdav"]) {
      data[key] ||= {};
      data[key].sync = policy(data[key].sync);
      const encrypted = data[key].secret;
      delete data[key].secret;
      data[key].hasPassword = !!encrypted;
      if (reveal && encrypted)
        data[key].password = this.safeStorage.decryptString(
          Buffer.from(encrypted, "base64"),
        );
    }
    return data;
  }
  save(root, kind, input) {
    const action = this.queue.then(async () => {
      if (!["webdav"].includes(kind)) throw fault("配置类型无效。");
      await this.store.update("connections", all => {
        const savedSecret = all[this.key(root)]?.[kind]?.secret;
        const previous = this.decode(all[this.key(root)] || {}, true);
        const savedPassword = previous[kind].password;
        let next;
        if (kind === "webdav") {
          const remote = String(input.directory || "/Moyu").replace(/\/$/, "");
          if (
            !remote.startsWith("/") ||
            remote
              .split("/")
              .some((p) => p === ".." || p === "." || /[\\\x00-\x1f]/.test(p))
          )
            throw fault("远端目录需要以 / 开头，且不能包含上级路径。");
          next = {
            url: validateURL(input.url, true),
            directory: remote || "/",
            username: String(input.username || "").slice(0, 300),
            sync: policy(input.sync || previous[kind].sync),
          };
        }
        next.password = input.clearPassword
          ? ""
          : String(input.password || previous[kind].password || "");
        previous[kind] = next;
        for (const value of Object.values(previous)) {
          const password = value.password;
          delete value.password;
          delete value.hasPassword;
          if (password) {
            if (savedSecret && password === savedPassword) {
              value.secret = savedSecret;
              continue;
            }
            if (
              !this.safeStorage.isEncryptionAvailable() ||
              this.safeStorage.getSelectedStorageBackend?.() === "basic_text"
            )
              throw fault(
                "系统凭据加密服务不可用，无法保存密码。请启用系统密钥环。",
              );
            value.secret = this.safeStorage
              .encryptString(password)
              .toString("base64");
          }
        }
        all[this.key(root)] = previous;
        return all;
      });
      return this.get(root);
    });
    this.queue = action.catch(() => {});
    return action;
  }
}
module.exports = { Connections, validateURL };
