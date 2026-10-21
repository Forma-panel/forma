import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDemo, localReply, makeTextScene, parseModelReply } from '../app/scenes.js';
import { SCENE_LIMITS, SceneValidationError, validateScene } from '../app/scene-validation.js';

function rejects(change, kind = 'chart', match = SceneValidationError) {
  const scene = getDemo(kind);
  change(scene);
  assert.throws(() => validateScene(scene), match);
}

test('all local fixtures are valid and independent objects', () => {
  for (const kind of ['welcome', 'text', 'chart', 'orbit', 'video']) {
    const scene = getDemo(kind);
    assert.equal(validateScene(scene).protocol, 'panel-scene/0.3');
    scene.nodes[0].id = 'changed';
    assert.equal(getDemo(kind).nodes[0].id, 'answer');
  }
  assert.equal(getDemo('welcome').nodes.length, 1, '待机板只显示中心液体，不堆叠欢迎文字');
  assert.equal(getDemo('orbit').animations[0].target, 'moonOrbit');
});

test('compatible text/chart specification fixtures pass; future subtitle capability is rejected', async () => {
  for (const name of ['text', 'chart']) {
    const fixture = JSON.parse(await readFile(new URL(`../specs/examples/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(validateScene(fixture).protocol, 'panel-scene/0.3');
  }
  const media = JSON.parse(await readFile(new URL('../specs/examples/motion-media.json', import.meta.url), 'utf8'));
  assert.throws(() => validateScene(media), /尚不支持独立封面或外部字幕/);
  delete media.nodes.find((node) => node.kind === 'video').captionsAssetId;
  assert.equal(validateScene(media).protocol, 'panel-scene/0.3');
});

test('unknown executable fields, old protocol, capabilities and unregistered sources are rejected', () => {
  rejects((s) => { s.script = 'fetch("https://example.com")'; });
  rejects((s) => { s.nodes[1].onclick = 'alert(1)'; });
  rejects((s) => { s.protocol = 'panel-scene/0.2'; });
  rejects((s) => { s.capabilities = ['html']; });
  rejects((s) => { s.nodes[1].sourceRefs = ['madeUpSource']; });
  rejects((s) => { s.nodes[0].direction = 'row'; });
  const emptySources = getDemo('text');
  emptySources.nodes[1].sourceRefs = [];
  assert.doesNotThrow(() => validateScene(emptySources));
});

test('identifiers, parents, cycles, and layout constraints are enforced', () => {
  rejects((s) => { s.nodes[1].id = 'answer'; });
  rejects((s) => { s.datasets[0].id = 'answer'; });
  rejects((s) => { s.nodes[1].parentId = 'missing'; });
  rejects((s) => { s.nodes[1].parentId = 'revenue'; });
  rejects((s) => { s.nodes[0].parentId = 'answer'; });
  rejects((s) => { s.nodes[1].layout = { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 }; });
  rejects((s) => { s.nodes.find((n) => n.id === 'earth').layout.mode = 'flow'; }, 'orbit');
  rejects((s) => { delete s.nodes.find((n) => n.id === 'figure').viewBox; }, 'orbit');
  const deep = getDemo('welcome');
  for (let i = 1; i <= 8; i++) deep.nodes.push({ id: `group${i}`, parentId: i === 1 ? 'answer' : `group${i - 1}`, kind: 'group', direction: 'column', layout: { mode: 'flow' } });
  assert.throws(() => validateScene(deep), /深度超过 8/);
});

test('dataset field types and complete keys are strict, nulls and negative/zero values survive', () => {
  for (const value of [NaN, Infinity, -Infinity, '42', undefined]) rejects((s) => { s.datasets[0].rows[0].values.value = value; });
  rejects((s) => { delete s.datasets[0].rows[0].values.value; });
  rejects((s) => { s.datasets[0].rows[0].values.extra = 10; });
  rejects((s) => { s.datasets[0].rows[0].values.month = 12; });
  rejects((s) => { s.datasets[0].rows[1].key = s.datasets[0].rows[0].key; });
  rejects((s) => { s.datasets[0].fields[1].name = 'month'; });
  for (const value of [null, -10, 0, 1.25]) {
    const scene = getDemo('chart');
    scene.datasets[0].rows[0].values.value = value;
    assert.equal(validateScene(scene).datasets[0].rows[0].values.value, value);
  }
});

test('chart references and zero baseline cannot be misrepresented', () => {
  rejects((s) => { s.nodes.find((n) => n.kind === 'chart').datasetId = 'missing'; });
  rejects((s) => { s.nodes.find((n) => n.kind === 'chart').xField = 'missing'; });
  rejects((s) => { s.nodes.find((n) => n.kind === 'chart').yField = 'month'; });
  rejects((s) => { s.nodes.find((n) => n.kind === 'chart').zeroBaseline = false; });
});

test('animations have complete ordered timelines and only supported targets/properties', () => {
  rejects((s) => { s.animations[0].target = 'title'; }, 'orbit');
  rejects((s) => { s.animations[0].target = 'figure'; }, 'orbit');
  rejects((s) => { s.animations[0].property = 'script'; }, 'orbit');
  rejects((s) => { s.animations[0].keyframes[1].timeMs = 0; }, 'orbit');
  rejects((s) => { s.animations[0].keyframes[0].timeMs = 1; }, 'orbit');
  rejects((s) => { s.animations[0].keyframes[1].timeMs = 1000; }, 'orbit');
  rejects((s) => { s.animations[0].property = 'opacity'; }, 'orbit');
  rejects((s) => { s.animations.push({ ...s.animations[0], id: 'secondTimeline' }); }, 'orbit');
});

test('actions validate both whitelist and target capability', () => {
  rejects((s) => { s.actions[0].target = 'title'; });
  rejects((s) => { s.actions[0].kind = 'open-url'; });
  rejects((s) => { s.actions[1].target = 'missing'; });
  rejects((s) => { s.actions = [{ id: 'toggle', target: 'title', kind: 'toggle-playback', label: '播放' }]; });
  rejects((s) => { s.nodes.find((n) => n.kind === 'video').assetId = 'https://example.com/movie.mp4'; }, 'video');
});

test('quotas bound combined text, nodes, rows and byte count', () => {
  assert.throws(() => makeTextScene('中'.repeat(SCENE_LIMITS.textCharacters)), /累计文本/);
  rejects((s) => { s.nodes[1].text = 'a'.repeat(SCENE_LIMITS.textCharacters + 1); });
  rejects((s) => { for (let i = 0; i < 64; i++) s.nodes.push({ id: `extra${i}`, parentId: 'answer', kind: 'text', role: 'body', text: 'x', layout: { mode: 'flow' } }); });
  rejects((s) => { s.datasets[0].rows = Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, values: { month: '月', value: i } })); });
  rejects((s) => { s.datasets[0].rows = Array.from({ length: 200 }, (_, i) => ({ key: `k${i}`, values: { month: '文'.repeat(1000), value: i } })); }, 'chart', /128 KiB/);
});

test('validator isolates input and rejects non-JSON objects without invoking getters', () => {
  const original = getDemo('chart');
  const copy = validateScene(original);
  copy.datasets[0].rows[0].values.value = 999;
  assert.equal(original.datasets[0].rows[0].values.value, 28);
  const circular = getDemo('text');
  circular.extra = circular;
  assert.throws(() => validateScene(circular), /循环引用/);
  const getter = getDemo('text');
  Object.defineProperty(getter, 'secret', { enumerable: true, get() { throw new Error('getter invoked'); } });
  assert.throws(() => validateScene(getter), /不允许访问器/);
  assert.throws(() => validateScene(new Date()), /普通 JSON/);
});

test('JSON and fenced JSON parse strictly; malformed structured outputs never become fake answers', () => {
  const scene = getDemo('chart');
  assert.deepEqual(parseModelReply(JSON.stringify(scene)), scene);
  assert.deepEqual(parseModelReply('```json\n' + JSON.stringify(scene) + '\n```'), scene);
  for (const bad of ['{"protocol":', '{"protocol":"panel-scene/0.2"}', '[]', 'null', '```json\nnot JSON\n```']) assert.throws(() => parseModelReply(bad));
  const prose = '收入可能变化，但这里没有提供数据。';
  const textScene = parseModelReply(prose);
  assert.equal(textScene.nodes.find((n) => n.id === 'body').text, prose);
  assert.equal(textScene.nodes.some((n) => n.kind === 'chart'), false);
  const code = '```javascript\nconst value = 1;\n```';
  assert.equal(parseModelReply(code).nodes.find((n) => n.id === 'body').text, code);
});

test('local replies identify their origin and chart changes preserve values without mutation', () => {
  const initial = getDemo('chart');
  const { scene, label } = localReply('切换折线图', initial);
  assert.equal(label, '本地示例');
  assert.equal(scene.nodes.find((n) => n.kind === 'chart').chartType, 'line');
  assert.equal(initial.nodes.find((n) => n.kind === 'chart').chartType, 'bar');
  assert.deepEqual(scene.datasets, initial.datasets);
  const unknown = localReply('帮我解释量子纠缠');
  assert.equal(unknown.scene.nodes.find((n) => n.id === 'body').text, '帮我解释量子纠缠');
  assert.match(unknown.scene.nodes.find((n) => n.role === 'caption').text, /尚未连接 AI/);
  assert.equal(localReply('看看月球轨道').scene.summary, 'orbit');
  assert.equal(localReply('播放视频').scene.summary, 'video');
  assert.equal(localReply('演示收入图').scene.summary, 'chart');
});
