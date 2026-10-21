/** The supported, bounded subset of panel-scene/0.3 for Forma 1.0. */
export const SCENE_LIMITS = Object.freeze({
  bytes: 128 * 1024, nodes: 64, textCharacters: 10000, depth: 8,
  datasets: 16, rowsPerDataset: 200, fieldsPerDataset: 32,
  animations: 32, actions: 64,
});

export class SceneValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'SceneValidationError';
    this.path = path;
  }
}

const fail = (path, message) => { throw new SceneValidationError(path, message); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function object(value, path, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, '不支持的字段');
  for (const key of required) if (!own(value, key)) fail(`${path}.${key}`, '缺少必需字段');
}

function string(value, path, min = 1, max = 2000) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(path, `必须是 ${min}–${max} 字符的字符串`);
  }
}

function id(value, path) {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(path, '必须是有效的本地标识符，不能使用 URL');
}

function number(value, path, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(path, `必须是 ${min}–${max} 范围内的有限${integer ? '整数' : '数值'}`);
  }
}

function choice(value, path, choices) {
  if (!choices.includes(value)) fail(path, `本版仅支持 ${choices.join('、')}`);
}

function array(value, path, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `必须是 ${min}–${max} 项的数组`);
}

function preflight(value, path = '$', ancestors = new Set(), depth = 0) {
  if (depth > 24) fail(path, 'JSON 嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, '不允许 NaN 或 Infinity');
    return;
  }
  if (typeof value !== 'object') fail(path, '只允许 JSON 数据');
  if (ancestors.has(value)) fail(path, '不允许循环引用');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail(path, '只允许普通 JSON 对象');
  }
  ancestors.add(value);
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(`${path}.${key}`, '不允许此字段');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) fail(`${path}.${key}`, '不允许访问器');
    preflight(value[key], `${path}.${key}`, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function layout(value, path) {
  if (value?.mode === 'flow') {
    object(value, path, ['mode', 'width', 'height'], ['mode']);
    if (own(value, 'width') && !['fill', 'fit'].includes(value.width)) number(value.width, `${path}.width`, 1, 8192);
    if (own(value, 'height') && value.height !== 'auto') number(value.height, `${path}.height`, 1, 8192);
  } else if (value?.mode === 'absolute') {
    object(value, path, ['mode', 'x', 'y', 'width', 'height']);
    number(value.x, `${path}.x`, -8192, 8192);
    number(value.y, `${path}.y`, -8192, 8192);
    number(value.width, `${path}.width`, 0.1, 8192);
    number(value.height, `${path}.height`, 0.1, 8192);
  } else fail(`${path}.mode`, '本版仅支持 flow、absolute');
}

const nodeFields = {
  group: ['direction', 'gap', 'viewBox'], text: ['text', 'role'],
  chart: ['datasetId', 'chartType', 'xField', 'yField', 'label', 'unit', 'zeroBaseline'],
  shape: ['shape', 'material', 'label'], image: ['assetId', 'alt', 'fit'],
  video: ['assetId', 'label', 'posterAssetId', 'captionsAssetId', 'fit'],
};

const nodeRequired = {
  group: ['direction'], text: ['text', 'role'],
  chart: ['datasetId', 'chartType', 'xField', 'yField', 'label', 'unit'],
  shape: ['shape', 'material', 'label'], image: ['assetId', 'alt', 'fit'],
  video: ['assetId', 'label', 'fit'],
};

/** Validate without coercion or repair, and return an isolated JSON clone. */
export function validateScene(input) {
  preflight(input);
  const encoded = JSON.stringify(input);
  if (new TextEncoder().encode(encoded).byteLength > SCENE_LIMITS.bytes) fail('$', '场景超过 128 KiB');
  const scene = JSON.parse(encoded);
  object(scene, '$', ['protocol', 'summary', 'nodes', 'datasets', 'animations', 'actions']);
  if (scene.protocol !== 'panel-scene/0.3') fail('$.protocol', '仅接受 panel-scene/0.3');
  string(scene.summary, '$.summary');
  array(scene.nodes, '$.nodes', 1, SCENE_LIMITS.nodes);
  array(scene.datasets, '$.datasets', 0, SCENE_LIMITS.datasets);
  array(scene.animations, '$.animations', 0, SCENE_LIMITS.animations);
  array(scene.actions, '$.actions', 0, SCENE_LIMITS.actions);
  const ids = new Set();
  const register = (value, path) => {
    id(value, path);
    if (ids.has(value)) fail(path, `重复标识符 ${value}`);
    ids.add(value);
  };
  const nodes = new Map();
  let textCharacters = 0;
  scene.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    if (!node || !own(nodeFields, node.kind)) fail(`${path}.kind`, '不支持的节点类型');
    object(node, path, ['id', 'parentId', 'layout', 'sourceRefs', 'kind', ...nodeFields[node.kind]], ['id', 'parentId', 'layout', 'kind', ...nodeRequired[node.kind]]);
    register(node.id, `${path}.id`);
    if (node.parentId !== null) id(node.parentId, `${path}.parentId`);
    layout(node.layout, `${path}.layout`);
    if (own(node, 'sourceRefs')) array(node.sourceRefs, `${path}.sourceRefs`, 0, 0);
    nodes.set(node.id, node);
    switch (node.kind) {
      case 'group':
        choice(node.direction, `${path}.direction`, ['column', 'free']);
        if (own(node, 'gap')) number(node.gap, `${path}.gap`, 0, 64);
        if (node.direction === 'free' && !own(node, 'viewBox')) fail(`${path}.viewBox`, 'free 分组必须提供 viewBox');
        if (own(node, 'viewBox')) {
          if (node.direction !== 'free') fail(`${path}.viewBox`, '只有 free 分组支持 viewBox');
          object(node.viewBox, `${path}.viewBox`, ['width', 'height']);
          number(node.viewBox.width, `${path}.viewBox.width`, 1, 8192);
          number(node.viewBox.height, `${path}.viewBox.height`, 1, 8192);
        }
        break;
      case 'text':
        string(node.text, `${path}.text`, 1, SCENE_LIMITS.textCharacters);
        textCharacters += node.text.length;
        choice(node.role, `${path}.role`, ['title', 'body', 'caption', 'code']);
        break;
      case 'chart':
        for (const field of ['datasetId', 'xField', 'yField']) id(node[field], `${path}.${field}`);
        choice(node.chartType, `${path}.chartType`, ['bar', 'line']);
        string(node.label, `${path}.label`, 1, 200);
        string(node.unit, `${path}.unit`, 0, 64);
        if (own(node, 'zeroBaseline') && typeof node.zeroBaseline !== 'boolean') fail(`${path}.zeroBaseline`, '必须是布尔值');
        if (node.chartType === 'bar' && node.zeroBaseline === false) fail(`${path}.zeroBaseline`, '柱状图必须包含零基线');
        break;
      case 'shape':
        choice(node.shape, `${path}.shape`, ['circle', 'rect', 'line']);
        choice(node.material, `${path}.material`, ['primary', 'accent', 'muted', 'positive', 'negative']);
        string(node.label, `${path}.label`, 1, 200);
        if (node.shape === 'circle' && typeof node.layout.width === 'number' && typeof node.layout.height === 'number' && node.layout.width !== node.layout.height) fail(`${path}.layout`, 'circle 的宽高必须相等');
        break;
      case 'image':
      case 'video':
        id(node.assetId, `${path}.assetId`);
        choice(node.fit, `${path}.fit`, ['contain', 'cover']);
        string(node.kind === 'image' ? node.alt : node.label, `${path}.${node.kind === 'image' ? 'alt' : 'label'}`, 1, node.kind === 'image' ? 500 : 200);
        for (const field of ['posterAssetId', 'captionsAssetId']) if (own(node, field)) fail(`${path}.${field}`, '1.0 尚不支持独立封面或外部字幕');
        break;
    }
  });
  if (textCharacters > SCENE_LIMITS.textCharacters) fail('$.nodes', '累计文本超过 10000 字符');

  for (const node of scene.nodes) {
    const path = `$.nodes(${node.id})`;
    const parent = node.parentId === null ? null : nodes.get(node.parentId);
    if (node.parentId !== null && !parent) fail(`${path}.parentId`, '父节点不存在');
    if (parent && parent.kind !== 'group') fail(`${path}.parentId`, '父节点必须是 group');
    if (parent?.direction === 'free') {
      if (node.layout.mode !== 'absolute') fail(`${path}.layout`, 'free 分组的直接子项必须 absolute');
    } else if (node.layout.mode !== 'flow') fail(`${path}.layout`, 'absolute 节点必须是 free 分组的直接子项');
    const chain = new Set([node.id]);
    let cursor = parent;
    while (cursor) {
      if (chain.has(cursor.id)) fail(`${path}.parentId`, '父节点关系存在环');
      chain.add(cursor.id);
      if (chain.size > SCENE_LIMITS.depth) fail(`${path}.parentId`, '节点树深度超过 8');
      cursor = cursor.parentId === null ? null : nodes.get(cursor.parentId);
    }
  }

  const datasets = new Map();
  scene.datasets.forEach((dataset, index) => {
    const path = `$.datasets[${index}]`;
    object(dataset, path, ['id', 'fields', 'rows']);
    register(dataset.id, `${path}.id`);
    array(dataset.fields, `${path}.fields`, 1, SCENE_LIMITS.fieldsPerDataset);
    array(dataset.rows, `${path}.rows`, 0, SCENE_LIMITS.rowsPerDataset);
    const fields = new Map();
    dataset.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path}.fields[${fieldIndex}]`;
      object(field, fieldPath, ['name', 'type']);
      id(field.name, `${fieldPath}.name`);
      if (fields.has(field.name)) fail(`${fieldPath}.name`, '重复字段');
      choice(field.type, `${fieldPath}.type`, ['string', 'number']);
      fields.set(field.name, field.type);
    });
    const keys = new Set();
    dataset.rows.forEach((row, rowIndex) => {
      const rowPath = `${path}.rows[${rowIndex}]`;
      object(row, rowPath, ['key', 'values']);
      id(row.key, `${rowPath}.key`);
      if (keys.has(row.key)) fail(`${rowPath}.key`, '重复行键');
      keys.add(row.key);
      object(row.values, `${rowPath}.values`, [...fields.keys()]);
      for (const [field, type] of fields) {
        const value = row.values[field];
        if (value === null) continue;
        if (type === 'number') number(value, `${rowPath}.values.${field}`, -Number.MAX_VALUE, Number.MAX_VALUE);
        else string(value, `${rowPath}.values.${field}`, 0, 2000);
      }
    });
    datasets.set(dataset.id, { dataset, fields });
  });
  for (const node of scene.nodes) {
    if (node.kind !== 'chart') continue;
    const source = datasets.get(node.datasetId);
    if (!source) fail(`$.nodes(${node.id}).datasetId`, '数据集不存在');
    if (!source.fields.has(node.xField)) fail(`$.nodes(${node.id}).xField`, '字段不存在');
    if (source.fields.get(node.yField) !== 'number') fail(`$.nodes(${node.id}).yField`, '必须引用数值字段');
  }

  const animated = new Set();
  const animatedNodes = new Set();
  scene.animations.forEach((animation, index) => {
    const path = `$.animations[${index}]`;
    object(animation, path, ['id', 'target', 'property', 'durationMs', 'repeat', 'keyframes']);
    register(animation.id, `${path}.id`);
    id(animation.target, `${path}.target`);
    const target = nodes.get(animation.target);
    if (!target || !['shape', 'group'].includes(target.kind) || target.layout.mode !== 'absolute' || (target.kind === 'group' && target.direction !== 'free')) fail(`${path}.target`, '动画只支持 free 区域中的绝对定位 shape 或 free group');
    choice(animation.property, `${path}.property`, ['rotate', 'translateX', 'translateY', 'opacity']);
    number(animation.durationMs, `${path}.durationMs`, 100, 60000, true);
    choice(animation.repeat, `${path}.repeat`, ['once', 'loop']);
    array(animation.keyframes, `${path}.keyframes`, 2, 32);
    const binding = `${animation.target}:${animation.property}`;
    if (animated.has(binding)) fail(`${path}.property`, '同一对象属性不能有重复时间线');
    animated.add(binding);
    animatedNodes.add(animation.target);
    let previous = -1;
    animation.keyframes.forEach((frame, frameIndex) => {
      const framePath = `${path}.keyframes[${frameIndex}]`;
      object(frame, framePath, ['timeMs', 'value']);
      number(frame.timeMs, `${framePath}.timeMs`, 0, animation.durationMs, true);
      if (frame.timeMs <= previous) fail(`${framePath}.timeMs`, '时间必须严格递增');
      previous = frame.timeMs;
      const min = animation.property === 'opacity' ? 0 : animation.property === 'rotate' ? -100000 : -8192;
      const max = animation.property === 'opacity' ? 1 : animation.property === 'rotate' ? 100000 : 8192;
      number(frame.value, `${framePath}.value`, min, max);
    });
    if (animation.keyframes[0].timeMs !== 0 || animation.keyframes.at(-1).timeMs !== animation.durationMs) fail(`${path}.keyframes`, '时间线必须从 0 开始并在 durationMs 结束');
  });

  scene.actions.forEach((action, index) => {
    const path = `$.actions[${index}]`;
    const fields = ['id', 'target', 'kind', 'label'];
    if (action?.kind === 'set-chart-type') fields.push('chartType');
    object(action, path, fields);
    register(action.id, `${path}.id`);
    id(action.target, `${path}.target`);
    const target = nodes.get(action.target);
    if (!target) fail(`${path}.target`, '动作目标不存在');
    choice(action.kind, `${path}.kind`, ['ask-selection', 'set-chart-type', 'toggle-playback']);
    string(action.label, `${path}.label`, 1, 64);
    if (action.kind === 'set-chart-type') {
      if (target.kind !== 'chart') fail(`${path}.target`, '图表切换仅支持 chart');
      choice(action.chartType, `${path}.chartType`, ['bar', 'line']);
    }
    if (action.kind === 'toggle-playback' && target.kind !== 'video' && !animatedNodes.has(target.id)) fail(`${path}.target`, '播放动作仅支持 video 或直接拥有动画的节点');
  });
  return scene;
}
