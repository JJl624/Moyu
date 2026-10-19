const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) && !(a === 198 && [18, 19].includes(b));
  }
  // Only global unicast IPv6. This excludes loopback, mapped IPv4, link-local,
  // unique-local and NAT64 routes to private IPv4 services.
  return net.isIP(address) === 6 && /^[23][a-f\d]{3}:/i.test(address) && !/^(2002:|2001:(?:db8:|0+:|:))/i.test(address);
}
async function destination(value, lookup = dns.lookup, signal) {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /(^|\.)(localhost|local)$/i.test(host)) throw new Error('代码下载仅允许公共 HTTP(S) 地址。');
  let addresses;
  signal?.throwIfAborted();
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else if (!signal) addresses = await lookup(host, { all: true, verbatim: true });
  else addresses = await new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('代码运行禁止访问本机或内网服务。');
  return { url, address: addresses[0] };
}
async function downloadRuntimeFile(value, options = {}) {
  const lookup = options.lookup || dns.lookup, request = options.request || ((url, init, callback) => (url.protocol === 'https:' ? https : http).get(url, init, callback));
  const signal = AbortSignal.timeout(8000), maximum = 20 * 1024 * 1024;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const { url, address } = await destination(value, lookup, signal);
    const response = await new Promise((resolve, reject) => {
      // Pin the validated resolution for the actual connection; a second DNS
      // lookup or an inherited connection pool must not bypass address checks.
      const req = request(url, { signal, agent: false, lookup: (_host, init, callback) => init.all ? callback(null, [address]) : callback(null, address.address, address.family) }, resolve);
      req.on('error', reject);
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.resume();
      if (!response.headers.location || redirects === 5) throw new Error('下载重定向无效或过多。');
      value = new URL(response.headers.location, url).href;
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); throw new Error('HTTP ' + response.statusCode); }
    if (Number(response.headers['content-length']) > maximum) { response.destroy(); throw new Error('文件超过 20 MB。'); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response) { bytes += chunk.length; if (bytes > maximum) { response.destroy(); throw new Error('文件超过 20 MB。'); } chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
}
module.exports = { downloadRuntimeFile, destination, publicAddress };
