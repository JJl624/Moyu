const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
async function davServer(options = {}) {
  const headerTag = bytes => {
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const token = options.numericETag ? BigInt('0x'+hash.slice(0,16)).toString() : hash;
    return ['bare','mixed'].includes(options.etagStyle) ? token : '"'+token+'"';
  };
  const listingTag = bytes => options.etagStyle === 'mixed' ? '"'+headerTag(bytes)+'"' : headerTag(bytes);
  const times = options.omitTimes ? '' : `<d:getlastmodified>${options.lastModified || new Date().toUTCString()}</d:getlastmodified>${options.created ? `<d:creationdate>${options.created}</d:creationdate>` : ''}`;
  const files = new Map(),
    directories = new Set(["/"]),
    requests = [];
  let race = null,
    omitETag = false;
  let delayed;
  let lostPut;
  const failures = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const p =
      decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(
        /\/$/,
        "",
      ) || "/";
    requests.push({ method: req.method, path: p, headers: req.headers,at:Date.now() });
    if (delayed && delayed.path === p && delayed.method === req.method) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, delayed.ms);
        res.once('close', () => { clearTimeout(timer); resolve(); });
      });
      if (res.destroyed) return;
    }
    if (
      req.headers.authorization !==
      "Basic " + Buffer.from("user:secret").toString("base64")
    ) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
      res.end();
      return;
    }
    if (options.denyRoot && p === "/" && req.method === "PROPFIND") {
      res.writeHead(403);
      res.end();
      return;
    }
    const failure=failures.find(item=>item.times>0&&item.path===p&&item.method===req.method);
    if(failure){failure.times--;res.writeHead(failure.status,failure.headers||{});res.end();return;}
    if (race && race.path === p && req.method === (race.method || "PUT")) {
      files.set(p, Buffer.from(race.content));
      race = null;
    }
    const exists = files.has(p) || directories.has(p);
    if (
      (req.headers["if-match"] &&
        req.headers["if-match"] !== (files.has(p) ? headerTag(files.get(p)) : "")) ||
      (req.headers["if-none-match"] === "*" && exists)
    ) {
      res.writeHead(412);
      res.end();
      return;
    }
    if (req.method === "PROPFIND") {
      if (!exists) {
        res.writeHead(404);
        res.end();
        return;
      }
      const entries = [p];
      if (req.headers.depth !== "0")
        entries.push(
          ...[...directories, ...files.keys()].filter(
            (f) => f !== p && path.posix.dirname(f) === p,
          ),
        );
      const responses = entries
        .map(
          (f) =>
            `<d:response><d:href>${escape(f.split("/").map(encodeURIComponent).join("/"))}</d:href><d:propstat><d:prop><d:displayname>${escape(path.posix.basename(f))}</d:displayname><d:resourcetype>${directories.has(f) ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>${files.get(f)?.length || 0}</d:getcontentlength>${files.has(f) && !omitETag ? `<d:getetag>${escape(listingTag(files.get(f)))}</d:getetag>` : ""}${times}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        )
        .join("");
      res.writeHead(207, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
      );
    } else if (req.method === "MKCOL") {
      if (!directories.has(path.posix.dirname(p))) res.writeHead(409);
      else {
        directories.add(p);
        res.writeHead(201);
      }
      res.end();
    } else if (req.method === 'HEAD') {
      res.writeHead(files.has(p) ? 200 : 404, files.has(p) ? {ETag:headerTag(files.get(p))} : {});res.end();
    } else if (req.method === "GET") {
      if (!files.has(p)) {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, { ETag: headerTag(files.get(p)) });
        res.end(files.get(p));
      }
    } else if (req.method === "PUT") {
      if (!directories.has(path.posix.dirname(p))) res.writeHead(409);
      else {
        files.set(p, Buffer.concat(chunks));
        if(lostPut===p){lostPut=null;res.writeHead(503);res.end();return;}
        res.writeHead(201, { ETag: headerTag(files.get(p)), ...(options.lastModified ? {'Last-Modified':options.lastModified} : {}) });
      }
      res.end();
    } else if (req.method === "DELETE") {
      files.delete(p);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(405);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    files,
    directories,
    requests,
    setRace: (value) => {
      race = value;
    },
    noETag: () => {
      omitETag = true;
    },
    delay: value => { delayed = value; },
    loseNextPut: value => {lostPut=value;},
    fail: value => failures.push({...value,times:value.times??1}),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
module.exports = { davServer };
