#!/bin/zsh
# A Finder-friendly launcher. It only stops the child process it starts.
set -u

FORMA_PROJECT_DIR="${0:A:h}"
cd -- "$FORMA_PROJECT_DIR" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
FORMA_NODE="$(command -v node 2>/dev/null || true)"

if [[ -z "$FORMA_NODE" ]]; then
  print -r -- '未找到 Node.js。请安装 Node.js 22 或以上，再双击启动流形。'
  exit 1
fi
if ! "$FORMA_NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  print -r -- '流形需要 Node.js 22 或以上。请升级 Node.js 后重试。'
  exit 1
fi

FORMA_PORT="${FORMAPORT:-4173}"
if [[ "$FORMA_PORT" != <-> ]] || (( FORMA_PORT < 1 || FORMA_PORT > 65535 )); then
  print -r -- 'FORMAPORT 须为 1–65535 之间的端口号。'
  exit 1
fi
export FORMAPORT="$FORMA_PORT"
FORMA_URL="http://127.0.0.1:$FORMA_PORT"

forma_health() {
  "$FORMA_NODE" --input-type=module - "$FORMA_URL" <<'JS'
import http from 'node:http';
let request;
let settled = false;
function finish(code) {
  if (settled) return;
  settled = true;
  clearTimeout(deadline);
  process.exitCode = code;
  request?.destroy();
}
const deadline = setTimeout(() => finish(3), 1500);
request = http.get(new URL('/api/health', process.argv[2]), (response) => {
  let size = 0;
  let body = '';
  response.setEncoding('utf8');
  response.on('data', (chunk) => {
    size += Buffer.byteLength(chunk);
    if (size > 4096) { finish(3); return; }
    body += chunk;
  });
  response.on('end', () => {
    try {
      const result = JSON.parse(body);
      finish(response.statusCode === 200 && result.ok === true && result.version === '1.0.0' ? 0 : 3);
    } catch { finish(3); }
  });
  response.on('error', () => finish(3));
});
request.on('error', (error) => finish(error.code === 'ECONNREFUSED' ? 2 : 3));
JS
}

forma_health
FORMA_PROBE=$?
if (( FORMA_PROBE == 0 )); then
  print -r -- "已找到运行中的流形：$FORMA_URL"
  /usr/bin/open "$FORMA_URL"
  print -r -- '已复用已有服务。如需停止，请在原启动终端按 Ctrl+C。'
  exit 0
elif (( FORMA_PROBE != 2 )); then
  print -r -- "端口 $FORMA_PORT 已被其他服务占用，或健康状态无法确认。"
  print -r -- '未启动新服务，也不会结束其他进程。可用 FORMAPORT 更换端口。'
  exit 1
fi

print -r -- '正在启动流形 Forma 1.0…'
"$FORMA_NODE" server.mjs &
FORMA_SERVER_PID=$!
forma_stop() {
  if kill -0 "$FORMA_SERVER_PID" 2>/dev/null; then
    kill -TERM "$FORMA_SERVER_PID" 2>/dev/null || true
  fi
  wait "$FORMA_SERVER_PID" 2>/dev/null || true
  exit 0
}
trap forma_stop INT TERM HUP

FORMA_READY=0
for FORMA_ATTEMPT in {1..40}; do
  if ! kill -0 "$FORMA_SERVER_PID" 2>/dev/null; then break; fi
  if forma_health; then FORMA_READY=1; break; fi
  /bin/sleep 0.2
done

if (( FORMA_READY == 1 )); then
  print -r -- "已启动：$FORMA_URL"
  print -r -- '在此终端按 Ctrl+C 停止本次服务。'
  /usr/bin/open "$FORMA_URL" || print -r -- "浏览器未自动打开，请手动访问 $FORMA_URL"
else
  print -r -- '服务没有通过启动检查，请查看上面的错误。'
  if kill -0 "$FORMA_SERVER_PID" 2>/dev/null; then
    kill -TERM "$FORMA_SERVER_PID" 2>/dev/null || true
  fi
fi

wait "$FORMA_SERVER_PID"
FORMA_EXIT=$?
trap - INT TERM HUP
exit "$FORMA_EXIT"
