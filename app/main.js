import { ParticleCompiler } from './compiler.js';
import { getDemo, localReply, parseModelReply } from './scenes.js';

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'forma.history.v1';
const SETTINGS_KEY = 'forma.preferences.v1';
const qaMode = new URLSearchParams(location.search).get('qa') === '1';
const qaStorage = new Map();
const demoLabels = { welcome: '一块会回答的画布', text: '文字落板', chart: '数据有形', orbit: '轨道与运动', video: '逐帧短片' };
const media = new Map();
let activeMediaIds = new Set();
let provider = null;
let currentScene = null;
let currentLabel = '本地示例';
let currentHistoryId = null;
let selection = null;
let pending = null;
let generation = 0;
let toastTimer;
let mediaGeneration = 0;
let bundledMediaPromise = null;
let connectionRevision = 0;
let history = loadJSON(HISTORY_KEY, []).filter((item) => item && typeof item.id === 'string' && item.scene?.protocol === 'panel-scene/0.3').slice(0, 20);
const savedSettings = loadJSON(SETTINGS_KEY, {});
const settings = { style: savedSettings.style === 'grain' ? 'grain' : 'clear', reducedMotion: typeof savedSettings.reducedMotion === 'boolean' ? savedSettings.reducedMotion : matchMedia('(prefers-reduced-motion: reduce)').matches, disturbance: false };

function loadJSON(key, fallback) {
  try { const value = JSON.parse(qaMode ? qaStorage.get(key) || 'null' : localStorage.getItem(key)); return value && typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback) ? value : fallback; } catch { return fallback; }
}
function saveJSON(key, value) { try { if (qaMode) qaStorage.set(key, JSON.stringify(value)); else localStorage.setItem(key, JSON.stringify(value)); } catch { toast('浏览器存储不可用，本次面板仍可继续使用。'); } }
function uid() { return globalThis.crypto?.randomUUID?.() || `forma-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
function status(message, kind = 'ready') { $('board-status').textContent = message; $('board-status-dot').className = `status-dot ${kind}`; }
function setBusy(value) { $('send-prompt').hidden = value; $('stop-generation').hidden = !value; $('composer-form').setAttribute('aria-busy', String(value)); }
function errorMessage(error) { return typeof error === 'string' ? error : error?.message || '操作暂时未完成，请重试。'; }

let compiler;
try {
  compiler = new ParticleCompiler($('particle-canvas'), {
    semanticRoot: $('board-accessibility'),
    onStats(stats) {
      const count = Math.max(0, Number(stats.particles) || 0);
      $('particle-count').textContent = `${new Intl.NumberFormat('zh-CN').format(count)} 粒子`;
      $('frame-count').textContent = stats.active === false ? '静态' : `${Number.isFinite(stats.fps) ? Math.round(stats.fps) : '—'} FPS`;
      $('renderer-name').textContent = stats.backend || '本地渲染';
    },
    onSelect(value) { selection = value; renderSelection(); },
    onAction(action) {
      if (action.type === 'copy') copyText(action.text || compiler.getText());
      if (action.type === 'ask') { $('prompt').value = action.text || '解释一下选中的内容'; $('prompt').focus(); resizePrompt(); }
      if (action.type === 'scene-change' && action.scene) {
        currentScene = clone(action.scene);
        const entry = history.find((item) => item.id === currentHistoryId);
        if (entry) { entry.scene = clone(currentScene); saveJSON(HISTORY_KEY, history); }
        renderHistory();
      }
    },
    onError(message) { status(message, 'error'); toast(message); },
  });
} catch (error) {
  status(`无法初始化粒子画布：${errorMessage(error)}`, 'error');
  $('prompt').disabled = true;
  $('send-prompt').disabled = true;
  toast('粒子画布未能初始化。请使用支持 WebGL2 的浏览器。');
}

function renderSelection() {
  const text = selection?.text || selection?.label;
  $('selection-chip').hidden = !text;
  $('selection-text').textContent = text || '';
  $('selection-text').title = text || '';
}
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-scrim').hidden = true; $('toggle-sidebar').setAttribute('aria-expanded', 'false'); }
function pauseInactiveMedia(scene) {
  const used = new Set((scene.nodes || []).filter((n) => n.assetId).map((n) => n.assetId));
  for (const [id, asset] of media) {
    if (asset.element instanceof HTMLVideoElement) {
      if (!used.has(id) || !activeMediaIds.has(id)) {
        asset.element.pause();
        asset.resumeAfterHidden = false;
      }
    }
    if (used.has(id)) { asset.lastUsed = Date.now(); compiler?.registerMedia(id, asset.element); }
  }
  activeMediaIds = used;
  return [...used].filter((id) => !media.has(id));
}
function presentScene(scene, { label = '本地示例', title, save = false, historyId = null, animate = true, demo = null } = {}) {
  if (!compiler) return;
  currentScene = clone(scene);
  currentLabel = label;
  currentHistoryId = historyId;
  selection = null;
  renderSelection();
  const missing = pauseInactiveMedia(currentScene);
  compiler.setScene(currentScene, { animate: animate && !settings.reducedMotion });
  const displayTitle = title || scene.title || scene.summary || '新的面板';
  $('panel-title').textContent = displayTitle.slice(0, 60);
  document.title = `${displayTitle.slice(0, 30)} · 流形 Forma`;
  document.querySelectorAll('[data-demo]').forEach((button) => button.classList.toggle('active', button.dataset.demo === demo));
  status(missing.length ? '此历史包含未加载的本地媒体，请重新导入文件。' : `${label} · ${settings.disturbance ? '移动指针，扰动粒子' : '点击内容可引用追问'}`);
  if (save) {
    const entry = { id: uid(), title: displayTitle.slice(0, 60), label, scene: currentScene, createdAt: Date.now() };
    history.unshift(entry);
    history = history.slice(0, 20);
    currentHistoryId = entry.id;
    saveJSON(HISTORY_KEY, history);
  }
  renderHistory();
  closeSidebar();
}
function renderHistory() {
  const list = $('history-list');
  list.replaceChildren();
  if (!history.length) { const p = document.createElement('p'); p.className = 'history-empty'; p.textContent = '你的下一次表达，从这里开始。'; list.append(p); return; }
  history.forEach((item) => {
    const button = document.createElement('button');
    button.className = `history-item${item.id === currentHistoryId ? ' active' : ''}`;
    button.title = `${item.title} · ${item.label}`;
    const icon = document.createElement('span'); icon.className = 'history-icon'; icon.textContent = '◌'; icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.className = 'history-title'; title.textContent = item.title;
    const date = document.createElement('span'); date.className = 'history-date'; date.textContent = new Date(item.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    button.append(icon, title, date);
    button.addEventListener('click', async () => {
      stopGeneration(false);
      const ticket = ++mediaGeneration;
      try {
        const scene = validateSceneImport(item.scene);
        await prepareBundledMedia(scene);
        if (ticket !== mediaGeneration) return;
        presentScene(scene, { label: item.label, title: item.title, historyId: item.id });
      } catch (error) { toast(`无法打开这条历史：${errorMessage(error)}`); }
    });
    list.append(button);
  });
}
function setStyle(style) {
  settings.style = style;
  compiler?.setStyle(style);
  for (const mode of ['clear', 'grain']) { $(`style-${mode}`).classList.toggle('active', style === mode); $(`style-${mode}`).setAttribute('aria-pressed', String(style === mode)); }
  saveJSON(SETTINGS_KEY, settings);
}
function setReducedMotion(value) {
  settings.reducedMotion = value;
  compiler?.setReducedMotion(value);
  $('reduced-motion').setAttribute('aria-pressed', String(value));
  if (currentScene) pauseInactiveMedia(currentScene);
  saveJSON(SETTINGS_KEY, settings);
}
function stopGeneration(showStatus = true) {
  generation++;
  if (pending) {
    const { controller, requestId } = pending;
    controller.abort();
    fetch('/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) }).catch(() => {});
    pending = null;
  }
  setBusy(false);
  if (showStatus) status('已停止生成，保留当前面板');
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let body;
  try { body = await response.json(); } catch { throw new Error(`本地服务返回了无法识别的响应（${response.status}）`); }
  if (!response.ok) throw new Error(errorMessage(body.error || body.message || `请求失败（${response.status}）`));
  return body;
}
async function sendPrompt(text) {
  const prompt = text.trim();
  if (!prompt || !compiler) return;
  stopGeneration(false);
  mediaGeneration++;
  const ticket = generation;
  const requestId = uid();
  const controller = new AbortController();
  pending = { requestId, controller };
  const selected = selection?.text || selection?.label;
  const context = `${compiler.getText().slice(0, 20000)}${selected ? `\n\n用户当前引用：${selected.slice(0, 4000)}` : ''}`;
  const selectedProvider = provider;
  setBusy(true);
  status(selectedProvider?.configured ? '模型正在组织这次回答…' : '本地规则正在匹配示例…', 'busy');
  try {
    let scene;
    let label;
    if (selectedProvider?.configured) {
      const result = await request('/api/generate', { method: 'POST', signal: controller.signal, body: JSON.stringify({ requestId, prompt, context }) });
      scene = parseModelReply(result.text);
      label = `模型 · ${result.model || selectedProvider.model}`;
    } else {
      const result = await localReply(prompt, currentScene);
      scene = result.scene;
      label = '本地规则示例';
    }
    if (ticket !== generation || controller.signal.aborted) return;
    await prepareBundledMedia(scene);
    if (ticket !== generation || controller.signal.aborted) return;
    presentScene(scene, { title: prompt.slice(0, 45), label, save: true });
    $('prompt').value = '';
    resizePrompt();
  } catch (error) {
    if (ticket !== generation || controller.signal.aborted) return;
    status(`未能生成：${errorMessage(error)}`, 'error');
    toast(errorMessage(error));
  } finally {
    if (ticket === generation) { pending = null; setBusy(false); }
  }
}
async function copyText(text) {
  if (!text) { toast('当前面板没有可复制的文字。'); return; }
  try { await navigator.clipboard.writeText(text); toast('已复制面板中的真实文字'); }
  catch { toast('浏览器未允许剪贴板访问。可导出场景获取文字。'); }
}
function resizePrompt() { const input = $('prompt'); input.style.height = 'auto'; input.style.height = `${Math.min(130, Math.max(45, input.scrollHeight))}px`; }

async function loadMediaElement(url, isVideo) {
  const element = isVideo ? document.createElement('video') : new Image();
  if (isVideo) { element.muted = true; element.loop = true; element.playsInline = true; element.preload = 'auto'; }
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); element.removeEventListener(isVideo ? 'loadeddata' : 'load', loaded); element.removeEventListener('error', failed); };
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); if (isVideo) { element.pause(); element.removeAttribute('src'); element.load(); } reject(new Error('媒体无法解码。请尝试 PNG / JPEG 图片或 MP4 / WebM 视频。')); };
    element.addEventListener(isVideo ? 'loadeddata' : 'load', loaded, { once: true });
    element.addEventListener('error', failed, { once: true });
    timer = setTimeout(failed, 15000);
    element.src = url;
  });
  return element;
}
function releaseAsset(id) {
  const asset = media.get(id);
  if (!asset) return;
  compiler?.unregisterMedia?.(id);
  if (asset.element instanceof HTMLVideoElement) { asset.element.pause(); asset.element.removeAttribute('src'); asset.element.load(); }
  if (asset.url.startsWith('blob:')) URL.revokeObjectURL(asset.url);
  media.delete(id);
}
function trimMediaCache() {
  const inUse = new Set((currentScene?.nodes || []).map((node) => node.assetId).filter(Boolean));
  const unused = [...media].filter(([id, asset]) => !inUse.has(id) && !asset.bundled).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  while (media.size > 6 && unused.length) releaseAsset(unused.shift()[0]);
}
async function prepareBundledMedia(scene) {
  if (!scene?.nodes) throw new Error('回答没有可显示的场景。');
  const demo = getDemo('video');
  const sampleId = demo.nodes.find((node) => node.kind === 'video')?.assetId;
  if (!scene.nodes.some((node) => node.kind === 'video' && node.assetId === sampleId) || media.has(sampleId)) return;
  if (!bundledMediaPromise) {
    bundledMediaPromise = (async () => {
      const element = await loadMediaElement('/assets/sample.webm', true);
      media.set(sampleId, { element, url: '/assets/sample.webm', lastUsed: Date.now(), bundled: true });
      compiler?.registerMedia(sampleId, element);
    })().finally(() => { bundledMediaPromise = null; });
  }
  try { await bundledMediaPromise; } catch (error) { toast(errorMessage(error)); }
}
async function showDemo(name = 'welcome', save = true) {
  stopGeneration(false);
  const ticket = ++mediaGeneration;
  const scene = getDemo(name);
  try {
    await prepareBundledMedia(scene);
    if (ticket !== mediaGeneration) return;
    presentScene(scene, { label: '本地示例', title: demoLabels[name], save, demo: name });
  } catch (error) { status(errorMessage(error), 'error'); }
}
async function uploadMedia(file) {
  if (!file || !compiler) return;
  const isVideo = file.type.startsWith('video/');
  if (!isVideo && !file.type.startsWith('image/')) { toast('请选择一张图片或一个视频文件。'); return; }
  if (file.size > 150 * 1024 * 1024) { toast('1.0 版请使用小于 150 MB 的本地媒体。'); return; }
  stopGeneration(false);
  const ticket = ++mediaGeneration;
  const url = URL.createObjectURL(file);
  status('正在读取本地媒体…', 'busy');
  try {
    const element = await loadMediaElement(url, isVideo);
    if (ticket !== mediaGeneration) { if (isVideo) { element.pause(); element.removeAttribute('src'); element.load(); } URL.revokeObjectURL(url); return; }
    const id = `local-${uid()}`;
    media.set(id, { element, url, lastUsed: Date.now(), bundled: false });
    compiler.registerMedia(id, element);
    const title = file.name.slice(0, 80);
    const scene = { protocol: 'panel-scene/0.3', summary: `本地${isVideo ? '视频' : '图片'}：${title}`, nodes: [
      { id: 'answer', parentId: null, kind: 'group', direction: 'column', gap: 20, layout: { mode: 'flow', width: 'fill' } },
      ...(isVideo ? [
        { id: 'media-title', parentId: 'answer', kind: 'text', role: 'title', text: title, layout: { mode: 'flow' } },
        { id: 'media-description', parentId: 'answer', kind: 'text', role: 'caption', text: '使用画面下方的播放按钮控制短片。', layout: { mode: 'flow' } },
      ] : []),
      { id: 'local-media', parentId: 'answer', kind: isVideo ? 'video' : 'image', assetId: id, ...(isVideo ? { label: title } : { alt: title }), fit: 'contain', layout: { mode: 'flow', height: isVideo ? 300 : Math.max(100, compiler.height - 130) } },
    ], datasets: [], animations: [], actions: isVideo ? [{ id: 'toggle-media', target: 'local-media', kind: 'toggle-playback', label: '播放或暂停' }] : [] };
    presentScene(scene, { label: '本地媒体 · 未上传', title, save: true });
    trimMediaCache();
    toast('文件仅在本机显示，未发送给模型。');
  } catch (error) { URL.revokeObjectURL(url); status(errorMessage(error), 'error'); }
}
function validateSceneImport(value) {
  if (!value || value.protocol !== 'panel-scene/0.3' || !Array.isArray(value.nodes)) throw new Error('需要 panel-scene/0.3 格式的场景 JSON。');
  if (value.nodes.length > 64) throw new Error('场景过大，1.0 版最多支持 64 个节点。');
  return parseModelReply(JSON.stringify(value));
}
async function importScene(file) {
  if (!file) return;
  if (file.size > 128 * 1024) { toast('场景 JSON 请小于 128 KiB。'); return; }
  stopGeneration(false);
  const ticket = ++mediaGeneration;
  try {
    const scene = validateSceneImport(JSON.parse(await file.text()));
    await prepareBundledMedia(scene);
    if (ticket !== mediaGeneration) return;
    presentScene(scene, { label: '导入场景', title: scene.title || file.name.replace(/\.json$/i, ''), save: true });
    toast('场景已导入。媒体文件不会随 JSON 自动加载。');
  } catch (error) { toast(`导入失败：${errorMessage(error)}`); }
}
function exportScene() {
  if (!currentScene) { toast('还没有可导出的面板。'); return; }
  const blob = new Blob([JSON.stringify(currentScene, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `forma-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出场景 JSON；本地媒体文件不包含在内。');
}

function renderConnection() {
  const connected = !!provider?.configured;
  $('connection-dot').classList.toggle('connected', connected);
  $('mode-dot').classList.toggle('connected', connected);
  $('connection-label').textContent = connected ? provider.model : '连接模型';
  $('connection-label').title = connected ? `已配置 ${provider.model}，点击管理连接` : '连接你的模型';
  $('mode-label').textContent = connected ? provider.model : '本地示例模式';
  $('mode-label').title = connected ? '请求将通过本地服务发送给所配置的模型' : '预设与规则示例，不是 AI 生成';
  $('composer-caption').replaceChildren(document.createTextNode('每一种回答，都在同一块粒子板上发生。'));
  const detail = document.createElement('span'); detail.textContent = connected ? '提问与当前面板文字将发送给你配置的模型。' : '当前为预设与本地规则示例，连接模型后可自由提问。'; $('composer-caption').append(detail);
  $('disconnect-model').hidden = !connected;
}
function openConnection() {
  $('provider-kind').value = provider?.kind || 'openai-compatible';
  $('provider-url').value = provider?.baseUrl || 'https://api.openai.com/v1';
  $('provider-model').value = provider?.model || '';
  $('provider-key').value = '';
  $('provider-key').placeholder = provider?.configured ? '修改连接时请重新填写密钥' : '粘贴 API Key（本地无鉴权服务可留空）';
  $('connection-error').hidden = true;
  $('connection-dialog').showModal();
}
async function saveConnection(event) {
  event.preventDefault();
  stopGeneration(false);
  connectionRevision++;
  const button = $('save-connection'); button.disabled = true;
  $('connection-error').hidden = true;
  try {
    const config = { kind: $('provider-kind').value, baseUrl: $('provider-url').value.trim(), model: $('provider-model').value.trim(), apiKey: $('provider-key').value.trim() };
    const result = await request('/api/config', { method: 'PUT', body: JSON.stringify(config) });
    provider = result.provider;
    $('provider-key').value = '';
    renderConnection();
    $('connection-dialog').close();
    toast('连接设置已保存。首次发送时会验证模型服务。');
  } catch (error) { $('connection-error').textContent = errorMessage(error); $('connection-error').hidden = false; }
  finally { button.disabled = false; }
}

$('composer-form').addEventListener('submit', (event) => { event.preventDefault(); sendPrompt($('prompt').value); });
$('prompt').addEventListener('input', resizePrompt);
$('prompt').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendPrompt($('prompt').value); } });
$('stop-generation').addEventListener('click', () => stopGeneration());
$('new-panel').addEventListener('click', () => { $('prompt').value = ''; resizePrompt(); showDemo('welcome', false); });
$('clear-selection').addEventListener('click', () => { selection = null; renderSelection(); });
document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => showDemo(button.dataset.demo)));
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; sendPrompt(button.dataset.prompt); }));
$('style-clear').addEventListener('click', () => setStyle('clear'));
$('style-grain').addEventListener('click', () => setStyle('grain'));
$('reduced-motion').addEventListener('click', () => setReducedMotion(!settings.reducedMotion));
$('disturbance').addEventListener('click', () => { settings.disturbance = !settings.disturbance; compiler?.setDisturbance(settings.disturbance); $('disturbance').setAttribute('aria-pressed', String(settings.disturbance)); status(settings.disturbance ? '扰动已开启 · 移动指针，触碰粒子' : `${currentLabel} · 点击内容可引用追问`); });
$('copy-answer').addEventListener('click', () => copyText(compiler?.getText()));
$('clear-history').addEventListener('click', () => { history = []; currentHistoryId = null; saveJSON(HISTORY_KEY, history); renderHistory(); toast('本机面板历史已清空，当前画面保留。'); });
$('toggle-sidebar').addEventListener('click', () => { const open = !$('sidebar').classList.contains('open'); $('sidebar').classList.toggle('open', open); $('sidebar-scrim').hidden = !open; $('toggle-sidebar').setAttribute('aria-expanded', String(open)); });
$('sidebar-scrim').addEventListener('click', closeSidebar);
$('connect-model').addEventListener('click', openConnection);
$('close-connection').addEventListener('click', () => { $('provider-key').value = ''; $('connection-dialog').close(); });
$('connection-dialog').addEventListener('close', () => { $('provider-key').value = ''; });
$('connection-form').addEventListener('submit', saveConnection);
$('provider-kind').addEventListener('change', () => { const url = $('provider-url'); if (!url.value || /^https:\/\/api\.(openai|anthropic)\.com(?:\/v1)?\/?$/.test(url.value)) url.value = $('provider-kind').value === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'; });
$('disconnect-model').addEventListener('click', async () => { stopGeneration(false); connectionRevision++; try { await request('/api/config', { method: 'DELETE' }); provider = null; renderConnection(); $('provider-key').value = ''; $('connection-dialog').close(); toast('模型已断开，已切回本地示例模式。'); } catch (error) { $('connection-error').textContent = errorMessage(error); $('connection-error').hidden = false; } });
$('import-scene').addEventListener('click', () => $('scene-file').click());
$('export-scene').addEventListener('click', exportScene);
$('scene-file').addEventListener('change', (event) => { importScene(event.target.files[0]); event.target.value = ''; });
$('upload-media').addEventListener('click', () => $('media-file').click());
$('media-file').addEventListener('change', (event) => { uploadMedia(event.target.files[0]); event.target.value = ''; });
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !$('connection-dialog').open) { event.preventDefault(); $('new-panel').click(); $('prompt').focus(); } if (event.key === 'Escape') closeSidebar(); });
document.addEventListener('visibilitychange', () => {
  if (!compiler) return;
  if (document.hidden) {
    compiler.pause();
    for (const asset of media.values()) if (asset.element instanceof HTMLVideoElement) { asset.resumeAfterHidden = !asset.element.paused; asset.element.pause(); }
  } else {
    compiler.resume();
    for (const [id, asset] of media) if (asset.resumeAfterHidden && activeMediaIds.has(id)) { asset.resumeAfterHidden = false; asset.element.play().catch(() => {}); }
  }
});
window.addEventListener('beforeunload', () => { pending?.controller.abort(); compiler?.destroy(); for (const id of media.keys()) releaseAsset(id); });

renderHistory();
renderConnection();
setStyle(settings.style);
setReducedMotion(settings.reducedMotion);
request('/api/config').then((result) => { if (connectionRevision === 0) { provider = result.provider; renderConnection(); } }).catch(() => { if (connectionRevision === 0) status('本地服务暂不可用 · 可继续浏览示例'); });
showDemo('welcome', false);
Object.defineProperty(window, 'forma', { value: Object.freeze({ compiler, showDemo, get scene() { return currentScene ? clone(currentScene) : null; }, get state() { return { busy: !!pending, mode: provider?.configured ? 'model' : 'local-demo', style: settings.style, reducedMotion: settings.reducedMotion, disturbance: settings.disturbance, historyCount: history.length, mediaCount: media.size, qa: qaMode }; } }), writable: false });
