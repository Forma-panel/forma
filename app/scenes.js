import { SCENE_LIMITS, validateScene } from './scene-validation.js';

const flow = (height) => ({ mode: 'flow', ...(height ? { height } : {}) });
const absolute = (x, y, width, height) => ({ mode: 'absolute', x, y, width, height });
const text = (id, content, role = 'body') => ({ id, parentId: 'answer', kind: 'text', role, text: content, layout: flow() });
const root = () => ({ id: 'answer', parentId: null, kind: 'group', direction: 'column', gap: 22, layout: { mode: 'flow', width: 'fill' } });
const draft = (summary, nodes, extra = {}) => validateScene({ protocol: 'panel-scene/0.3', summary, nodes: [root(), ...nodes], datasets: [], animations: [], actions: [], ...extra });

export function makeTextScene(content, title = '一个回答，正在成形。') {
  if (typeof content !== 'string' || !content.trim()) throw new Error('回答文本不能为空');
  return draft('text', [text('title', title, 'title'), text('body', content)]);
}

/** Fresh, validated fixtures. Every chart value is explicitly demonstration data. */
export function getDemo(kind = 'welcome') {
  if (kind === 'welcome') return draft('welcome', []);
  if (kind === 'text') return draft('text', [
    text('title', '把一个想法，看清楚。', 'title'),
    text('body', '一个想法出现时，往往还没有清晰的边界。它像水中的微光，等待被排列，等待彼此连接。\n\n在这里，粒子并不是回答前的一段装饰。它们落在板上，成为文字的笔画、图表的线条，也成为不断变化的画面。内容改变时，这些显示单元继续承载新的表达。\n\n你仍然可以读、复制、点选和追问。让表达有形，是为了让理解更自然。'),
    text('caption', '本地示例 · 这段文字由内置场景提供，尚未调用 AI。', 'caption'),
  ]);
  if (kind === 'chart') return draft('chart', [
    text('title', '让数字，说出变化。', 'title'),
    text('description', '同一组数据，可以有不同的观看方式。点击柱体或数据点，查看对应的月份与数值。'),
    { id: 'revenue', parentId: 'answer', kind: 'chart', chartType: 'bar', datasetId: 'revenueData', xField: 'month', yField: 'value', unit: '万元', label: '六个月收入变化（演示数据）', zeroBaseline: true, layout: flow(290) },
    text('caption', '本地示例 · 1—6 月收入为 28、42、36、64、52、86 万元；不代表真实业务。', 'caption'),
  ], {
    datasets: [{ id: 'revenueData', fields: [{ name: 'month', type: 'string' }, { name: 'value', type: 'number' }], rows: [28, 42, 36, 64, 52, 86].map((value, index) => ({ key: `month${index + 1}`, values: { month: `${index + 1}月`, value } })) }],
    actions: [{ id: 'changeChart', target: 'revenue', kind: 'set-chart-type', chartType: 'line', label: '切换折线' }, { id: 'askRevenue', target: 'revenue', kind: 'ask-selection', label: '继续追问' }],
  });
  if (kind === 'orbit') return draft('orbit', [
    text('title', '把时间，放进回答。', 'title'),
    text('description', '粒子可以停成一句话，也可以沿着规则持续运动。下面是一段地月轨道示意。'),
    { id: 'figure', parentId: 'answer', kind: 'group', direction: 'free', viewBox: { width: 720, height: 300 }, layout: flow(300) },
    { id: 'orbitRing', parentId: 'figure', kind: 'shape', shape: 'circle', material: 'muted', label: '轨道示意', layout: absolute(236, 26, 248, 248) },
    { id: 'earth', parentId: 'figure', kind: 'shape', shape: 'circle', material: 'accent', label: '地球示意', layout: absolute(325, 115, 70, 70) },
    { id: 'moonOrbit', parentId: 'figure', kind: 'group', direction: 'free', viewBox: { width: 248, height: 248 }, layout: absolute(236, 26, 248, 248) },
    { id: 'moon', parentId: 'moonOrbit', kind: 'shape', shape: 'circle', material: 'primary', label: '月球示意', layout: absolute(111, -13, 26, 26) },
    text('caption', '本地示例 · 大小、距离与周期均为视觉示意，非科学模拟。', 'caption'),
  ], {
    animations: [{ id: 'moonRevolution', target: 'moonOrbit', property: 'rotate', durationMs: 14000, repeat: 'loop', keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 14000, value: 360 }] }],
    actions: [{ id: 'toggleOrbit', target: 'moonOrbit', kind: 'toggle-playback', label: '暂停 / 继续' }],
  });
  if (kind === 'video') return draft('video', [
    text('title', '画面也由粒子组成。', 'title'),
    text('description', '视频帧提供颜色，粒子负责最终显示。每一帧都经过同一块粒子板。'),
    { id: 'clip', parentId: 'answer', kind: 'video', assetId: 'sampleVideo', label: '本地粒子视频演示', fit: 'contain', layout: flow(320) },
    text('caption', '本地示例 · 播放内置短片，未调用视频生成服务。', 'caption'),
  ], { actions: [{ id: 'toggleVideo', target: 'clip', kind: 'toggle-playback', label: '播放 / 暂停' }] });
  throw new Error(`未知示例：${kind}`);
}

/** Honest local routing, never presented as an AI-generated answer. */
export function localReply(prompt, currentScene) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('请输入问题');
  const question = prompt.trim();
  let scene;
  const currentChart = currentScene?.nodes?.find((node) => node.kind === 'chart');
  if (currentChart && /改|切换/.test(question) && /图|折线|柱状/.test(question)) {
    scene = validateScene(currentScene);
    const chart = scene.nodes.find((node) => node.id === currentChart.id);
    chart.chartType = /柱状/.test(question) ? 'bar' : /折线/.test(question) ? 'line' : chart.chartType === 'bar' ? 'line' : 'bar';
    if (chart.chartType === 'bar') chart.zeroBaseline = true;
    for (const action of scene.actions) {
      if (action.kind === 'set-chart-type' && action.target === chart.id) {
        action.chartType = chart.chartType === 'bar' ? 'line' : 'bar';
        action.label = action.chartType === 'bar' ? '切换柱状' : '切换折线';
      }
    }
    scene = validateScene(scene);
  } else if (/视频|短片|影片/.test(question)) scene = getDemo('video');
  else if (/轨道|月球|地球|动画|公转/.test(question)) scene = getDemo('orbit');
  else if (/图|收入|折线|柱状|数据/.test(question)) {
    scene = getDemo('chart');
    if (/折线/.test(question)) {
      scene.nodes.find((node) => node.kind === 'chart').chartType = 'line';
      scene.actions[0].chartType = 'bar';
      scene.actions[0].label = '切换柱状';
    }
  } else if (/文字示例|文字演示|粒子文字/.test(question)) scene = getDemo('text');
  else scene = draft('local-reply', [
    text('title', '这个问题，已留在板上。', 'title'),
    text('body', question),
    text('caption', '当前是本地示例模式，尚未连接 AI。这里展示的是你的原问题，并没有生成答案。连接模型后，同一块粒子板可以显示它的回复。', 'caption'),
  ]);
  return { scene, label: '本地示例' };
}

/** Structured JSON is strict; ordinary text remains real text, never invented charts. */
export function parseModelReply(reply) {
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('模型返回了空内容');
  if (new TextEncoder().encode(reply).byteLength > SCENE_LIMITS.bytes) throw new Error('模型回复超过 128 KiB');
  const trimmed = reply.trim();
  const fenced = trimmed.match(/^```json\s*\n?([\s\S]*?)\n?```$/i)
    ?? trimmed.match(/^```[ \t]*\n([\s\S]*?)\n?```$/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    // A malformed scene must remain an error instead of silently changing meaning.
    if (fenced || /^[\[{]/.test(candidate) || /^```json\b/i.test(trimmed)) throw new Error('模型场景不是有效 JSON');
    return makeTextScene(trimmed);
  }
  return validateScene(parsed);
}
