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
  password(value = {}) {
    if (typeof value.password === 'string') return value.password;
    if (!value.secret) return '';
    // Read passwords saved by earlier versions once; all new writes are plain
    // local configuration and do not need an operating-system keyring.
    try { return this.safeStorage.decryptString(Buffer.from(value.secret, 'base64')); }
    catch { throw fault('已保存的旧密码无法读取，请重新输入。'); }
  }
  async get(root, reveal = false) {
    const all = await this.store.get('connections');
    return this.decode(all[this.key(root)] || {}, reveal);
  }
  decode(data, reveal) {
    const stored=data.webdav||{},webdav={...stored,sync:policy(stored.sync),hasPassword:!!(stored.password||stored.secret)};
    delete webdav.secret;
    delete webdav.password;
    if(reveal)webdav.password=this.password(stored);
    return {...data,webdav};
  }
  save(root, kind, input) {
    const action = this.queue.then(async () => {
      if (!["webdav"].includes(kind)) throw fault("配置类型无效。");
      await this.store.update("connections", all => {
        const stored = all[this.key(root)] || {};
        const previous = this.decode(stored, false);
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
        const password=input.clearPassword?'':String(input.password||this.password(stored[kind]));
        if(password)next.password=password;
        previous[kind] = next;
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
