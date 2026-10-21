import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { HttpError, fail } from './server/errors.mjs';
import { generate, publicConfig, validateConfig } from './server/provider.mjs';

const APP_ROOT = fileURLToPath(new URL('./app/', import.meta.url));
const BODY_LIMIT = 64 * 1024;
const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
}));
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:", "media-src 'self' blob:", "font-src 'self'", "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"].join('; ');

function guardOrigin(req) {
  const host = req.headers.host;
  if (req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'host').length !== 1 || typeof host !== 'string') {
    fail(403, 'invalid_host', '此服务只接受本机访问。');
  }
  const allowedHosts = ['127.0.0.1', 'localhost', '[::1]'].map((name) => `${name}:${req.socket.localPort}`);
  if (!allowedHosts.includes(host)) fail(403, 'invalid_host', '此服务只接受本机访问。');
  const origin = req.headers.origin;
  if ((origin !== undefined && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'invalid_origin', '请从流形面板页面发起请求。');
  if (!['GET', 'HEAD'].includes(req.method) && origin !== `http://${host}`) fail(403, 'origin_required', '修改配置和生成回答需要从同源面板发起。');
}

function pathname(req) {
  if (!req.url?.startsWith('/') || req.url.startsWith('//')) fail(400, 'invalid_path', '请求路径无效。');
  let path;
  try { path = decodeURIComponent(req.url.split('?')[0]); } catch { fail(400, 'invalid_path', '请求路径编码无效。'); }
  if (/[\x00-\x1f\x7f\\]/.test(path) || path.split('/').some((part) => part === '..' || part.startsWith('.'))) fail(404, 'not_found', '找不到这个资源。');
  return path;
}

function json(res, status, payload, head = false) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(head ? undefined : body);
}

function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'json_required', '请求需要使用 application/json。');
  if (Number(req.headers['content-length']) > BODY_LIMIT) fail(413, 'body_too_large', '请求超过 64 KiB，请缩短内容。');
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let ended = false;
    function settle(error, body) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('aborted', onAbort);
      req.removeListener('error', onError);
      if (error) { req.resume(); reject(error); } else resolveBody(body);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > BODY_LIMIT) { settle(new HttpError(413, 'body_too_large', '请求超过 64 KiB，请缩短内容。')); return; }
      chunks.push(chunk);
    }
    function onEnd() {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { settle(new HttpError(400, 'invalid_json', '请求中的 JSON 格式无效。')); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { settle(new HttpError(400, 'invalid_json', '请求必须是 JSON 对象。')); return; }
      settle(null, body);
    }
    function onAbort() { settle(new HttpError(499, 'cancelled', '请求已取消。')); }
    function onError() { settle(new HttpError(400, 'request_interrupted', '读取请求时连接中断。')); }
    const timer = setTimeout(() => settle(new HttpError(408, 'request_timeout', '读取请求超时。')), 15000);
    timer.unref();
    req.on('data', onData).on('end', onEnd).on('aborted', onAbort).on('error', onError);
  });
}

function requestId(value, optional = false) {
  if (value === undefined && optional) return randomUUID();
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(400, 'invalid_request_id', 'requestId 须为 1–128 位字母、数字、下划线或短横线。');
  return value;
}

function rangeFor(header, size) {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function serveFile(req, res, path, root) {
  if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'method_not_allowed', '此资源不支持该请求方法。');
  const relative = path === '/' ? 'index.html' : path.slice(1);
  const extension = extname(relative).toLowerCase();
  if (!TYPES.has(extension) || relative.split('/').some((part) => /^(?:package(?:-lock)?\.json|.*\.(?:pem|key|env)|secrets?\..*)$/i.test(part))) fail(404, 'not_found', '找不到这个资源。');
  let file;
  try {
    const realRoot = await realpath(root);
    const candidate = await realpath(resolve(realRoot, relative));
    if (!candidate.startsWith(realRoot + sep)) fail(404, 'not_found', '找不到这个资源。');
    file = await open(candidate, 'r');
    const stat = await file.stat();
    if (!stat.isFile()) fail(404, 'not_found', '找不到这个资源。');
    const range = rangeFor(req.headers.range, stat.size);
    if (range === false) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}`, 'content-length': 0 });
      res.end();
      return;
    }
    const headers = { 'content-type': TYPES.get(extension), 'accept-ranges': 'bytes', 'content-length': range ? range.end - range.start + 1 : stat.size };
    if (range) headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(file.createReadStream({ ...(range || {}), autoClose: false }), res);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) fail(404, 'not_found', '找不到这个资源。');
    if (!res.destroyed) throw error;
  } finally { await file?.close().catch(() => {}); }
}

/** Importing this module never listens. The optional transport and small limits
 * support deterministic local tests; user configuration cannot override them. */
export function createServer({ appRoot = APP_ROOT, fetchImpl = globalThis.fetch, timeoutMs = 60000, maxResponseBytes = 2 * 1024 * 1024 } = {}) {
  let config = null;
  const active = new Map();
  function abortAll(message) {
    for (const controller of active.values()) controller.abort(new HttpError(499, 'cancelled', message));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', CSP);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    try {
      guardOrigin(req);
      const path = pathname(req);
      if (path === '/api/health' && ['GET', 'HEAD'].includes(req.method)) return json(res, 200, { ok: true, version: '1.0.0' }, req.method === 'HEAD');
      if (path === '/api/config') {
        if (['GET', 'HEAD'].includes(req.method)) return json(res, 200, { provider: publicConfig(config) }, req.method === 'HEAD');
        if (req.method === 'PUT') {
          const next = validateConfig(await readJson(req));
          abortAll('模型配置已更改，旧请求已取消。');
          config = next;
          return json(res, 200, { provider: publicConfig(config) });
        }
        if (req.method === 'DELETE') {
          abortAll('模型配置已清除，请求已取消。');
          config = null;
          return json(res, 200, { provider: null });
        }
        fail(405, 'method_not_allowed', '此 API 不支持该请求方法。');
      }
      if (path === '/api/cancel' && req.method === 'POST') {
        const id = requestId((await readJson(req)).requestId);
        const controller = active.get(id);
        controller?.abort(new HttpError(499, 'cancelled', '请求已取消。'));
        return json(res, 200, { requestId: id, cancelled: Boolean(controller) });
      }
      if (path === '/api/generate' && req.method === 'POST') {
        const body = await readJson(req);
        if (!config) fail(409, 'not_configured', '请先在设置中连接模型，或使用本地示例。');
        if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 16000) fail(400, 'invalid_prompt', '问题须为 1–16000 个字符。');
        if (body.context !== undefined && (typeof body.context !== 'string' || body.context.length > 32000)) fail(400, 'invalid_context', '上下文须为不超过 32000 个字符的文字。');
        const id = requestId(body.requestId, true);
        if (active.has(id)) fail(409, 'duplicate_request', '这个 requestId 仍在生成中。');
        if (active.size >= 4) fail(429, 'too_many_requests', '同时生成的请求过多，请等待当前回答完成。');
        const controller = new AbortController();
        active.set(id, controller);
        const timer = setTimeout(() => controller.abort(new HttpError(504, 'provider_timeout', '模型响应超过 60 秒，已停止等待。请稍后重试。')), timeoutMs);
        timer.unref();
        const onClose = () => { if (!res.writableFinished) controller.abort(new HttpError(499, 'cancelled', '客户端已断开，请求已取消。')); };
        res.on('close', onClose);
        try {
          const result = await generate(config, { prompt: body.prompt.trim(), context: body.context }, { signal: controller.signal, fetchImpl, maxBytes: maxResponseBytes });
          if (controller.signal.aborted) throw controller.signal.reason;
          return json(res, 200, { requestId: id, ...result });
        } finally {
          clearTimeout(timer);
          res.removeListener('close', onClose);
          active.delete(id);
        }
      }
      if (path.startsWith('/api/')) fail(404, 'unknown_api', '找不到这个 API。');
      await serveFile(req, res, path, appRoot);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof HttpError;
      if ([408, 413].includes(error.status)) res.setHeader('connection', 'close');
      json(res, known ? error.status : 500, { error: { code: known ? error.code : 'internal_error', message: known ? error.message : '本地服务遇到错误，请重试。' } }, req.method === 'HEAD');
    }
  });
  server.requestTimeout = 75000;
  server.headersTimeout = 15000;
  server.on('close', () => { config = null; abortAll('本地服务已关闭。'); });
  // Graceful process shutdown can stop in-flight provider requests before close.
  server.cancelActiveRequests = () => abortAll('本地服务正在关闭。');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.FORMAPORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('FORMAPORT 须为 1–65535 之间的端口号。\n');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', (error) => {
      process.stderr.write(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可设置 FORMAPORT 更换端口。\n` : '本地服务启动失败。\n');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => process.stdout.write(`流形 Forma 1.0 · http://127.0.0.1:${port}\n`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      server.cancelActiveRequests();
      server.close(() => { process.exitCode = 0; });
      server.closeIdleConnections();
    });
  }
}
