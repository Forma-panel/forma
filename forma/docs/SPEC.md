# Forma 工程规格（合并版 v1）

> 基准外观：`reference/v7.html`（sha256 见 `reference/v7.sha256`），即 `prototype/liquid/versions/v7-液团更小更精致.html`。
> 外观红线：所有新增着色器分支都有开关，关掉时与 v7 输出逐像素一致；落定后卡片内每个设备像素等于内容光栅（v7 的 `exact` 路径）。例外：卡片边缘不超过 6px 的液面边缘、鼠标拨动、一次性的高光扫过。
> 取舍原则：只做 3 个模板和演示站真正用到的东西。流式逐行成形、SLAB 变换、k×k 液滴、Markdown 适配、schema 自动生成，推迟到 v1.1。

## 1. 公开用法

### 1.1 原生 JS
```js
import { createForma } from 'forma-liquid';

const forma = createForma(document.querySelector('#stage'), {
  theme: 'auto',        // 'light' | 'dark' | 'auto'
  quality: 'auto',      // 'auto' | 'high' | 'medium' | 'low' | 'static'
  motion: 'auto',       // 'auto'（跟随 prefers-reduced-motion）| 'full' | 'reduced'
  background: 'studio', // 'studio'（v7 背景）| { top, bottom }
  assets: { sky: '/img/sky.webp' },   // JSON 里 "asset:sky" 的解析表
  onAction: e => console.log(e.action, e.href, e.label),
});

await forma.show(imgOrCanvas, { width: 540, height: 370, radius: 24, alt: '海报' });
await forma.show((ctx, w, h) => {                 // 绘制回调：fillText 自动成为可选文字
  ctx.font = '600 28px system-ui'; ctx.fillText('夜航', 28, 72);
  ctx.region(28, 280, 148, 46, { action: 'play', label: '播放' });
}, { width: 540, height: 370 });
await forma.show(document.querySelector('#pricing'));   // DOM 元素（beta）
await forma.show({ forma: 1, width: 480, blocks: [ /* … */ ] }); // JSON 内容描述
await forma.retract();
forma.setTheme('dark'); forma.setQuality('medium');
forma.on('state', s => {}); // 'blob' | 'forming' | 'shown' | 'morphing' | 'retracting'
forma.destroy();
```
- `show()` 按状态自动选择：液团时成形，已成形时变换；同尺寸时液浪只扫过像素差异的包围盒。
- Promise 在可交互时 resolve 为 `{status:'shown'}`；被更新的 `show` 取代时 resolve 为 `{status:'superseded'}`，不 reject。最新请求有效。
- 没有单独的 `update` / `stream` / `morph`。
- 静态辅助：`Forma.normalize(doc)` → `{doc, issues}`；`Forma.schema`；`Forma.supported()`。

### 1.2 React
```jsx
import { Forma } from 'forma-liquid/react';
<Forma ref={ref} style={{height: 640}} theme="auto" content={doc} onAction={e => ask(e.label)} />
<Forma style={{height: 560}}><PricingCard/></Forma>   {/* children 作为 DOM 来源 */}
```
实例在 `useEffect` 中创建（SSR 安全）；children 用 portal 挂进插槽；`content` 引用变化即 `show`，`null` 表示收回。

### 1.3 Vue 3
```vue
<Forma :content="doc" theme="auto" style="height:640px" @action="onAction" />
<Forma style="height:560px"><PricingCard/></Forma>
```

### 1.4 JSON 内容描述 v1
```json
{ "forma":1, "width":540, "surface":"card", "accent":"sunset",
  "blocks":[
    {"type":"heading","text":"上海 · 晴","level":1},
    {"type":"display","text":"26°"},
    {"type":"stats","items":[{"label":"体感","value":"28°"},{"label":"湿度","value":"62%"}]},
    {"type":"actions","items":[{"label":"未来 5 天","action":"forecast","primary":true},{"label":"来源","href":"https://example.com"}]}
  ]}
```
- 11 种块：heading（1–3）、text（`**粗**`、`[文字](https://…)`）、caption、display、list、stats（≤4，可带 tone）、chart（bar/line，≤64 点）、image（`asset:名字` 或开启 `allowRemoteImages` 时 https；alt 必填；ratio）、actions（≤3，action 或 href，可 primary）、countdown（ISO-8601 `to`，可带 label）、divider。
- 顶层：`surface` card | poster；`accent` violet/sunset/ocean/mint/mono；`width` 280–960，默认 540。明暗由宿主决定。
- 宽容修复：忽略未知字段；未知块有 text 则按 text 渲染否则丢弃；超长截断加 "…"；数字字符串转数字；非 http/https/mailto 链接降为纯文字；每处修复记一条 issue（JSON 路径）。
- 上限：≤30 块，≤32KB。不接受 HTML/CSS/JS；文字只用 textContent。

## 2. 模块划分（`src/`）

| 文件 | 职责 | 来自 v7（行号） |
|---|---|---|
| `index.js` | `createForma`、静态辅助 | — |
| `core/forma.js` | 公开类与状态机、最新有效、Promise、选择变换方式 | 586–620、663–683 |
| `core/placement.js` | 液团/卡片/剩余液团几何、液滴预算 N、整数设备像素定位 | 523–526、541–545、572–585、627–628 |
| `core/look.js` | v7 外观常量 + light/dark 两套 uniform 与排版色 | 散落常量、374、599 |
| `core/input.js` | 指针换算到容器内设备像素、速度平滑、按下状态 | 649–657、684–689 |
| `core/loop.js` | rAF、可见性与视口外暂停、空闲降帧、时间归零、可注入时钟、帧时间采样 | 659–740 |
| `gl/context.js` | 上下文创建与软件渲染探测、扩展、编译、资源登记表、丢失与恢复 | 37–43、327–344 |
| `gl/shaders.js` | v7 着色器原样 + 3 处带开关修改 | 46–325 |
| `gl/renderer.js` | 渲染目标与三遍渲染 | 347–370、692–734 |
| `sources/frame.js` | Frame：`{canvas, cssW, cssH, dpr, runs[], regions[], alt, ghostEl?}` | — |
| `sources/canvas.js` | img/canvas/ImageBitmap/绘制回调；拦截 fillText；`ctx.region`；圆角裁剪 | 527–540 |
| `sources/dom.js` | foreignObject 光栅器（单独入口 `forma-liquid/dom`） | — |
| `sources/json/normalize.js`、`schema.json` | 校验、宽容修复、issues | — |
| `sources/json/text.js` | 分行：Intl.Segmenter；中日韩逐字 + 行首禁则；行内粗体与链接 | 380–387 |
| `sources/json/blocks.js` | 11 种块的测量与绘制（v7 CONTENTS 样式） | 375–516 |
| `overlay/ghost.js` | 透明文字层、`<a>`/`<button>` 命中区、选区、ARIA、焦点环 | 10–12、560–571 |
| `quality.js` | 档位、调速器、降级持久化 | — |
| `fallback/static.js` | 无 GL 渲染器 | — |
| `react/index.jsx`、`vue/index.js` | 封装 | — |
| `templates/hero.js`、`answer.js`、`countdown.js` | 3 个模板 | 742–760 |

依赖方向：`sources/*` 只产出 Frame；`core` 接收 Frame 驱动 `gl`；`overlay` 只依赖 Frame。目标约 3k 行、零运行时依赖。工具：esbuild、Vitest、Playwright。

## 3. 内容来源

统一输出 Frame：光栅尺寸 `round(cssW*dpr) × round(cssH*dpr)`，直通 alpha，α>0.5 算液体；`UNPACK_PREMULTIPLY_ALPHA=false`，NEAREST、RGBA8，texelFetch 1:1。

### 3.1 图片 / canvas / 绘制回调
按 CSS 尺寸×dpr 建 canvas → cover/contain 绘制 → 圆角 clip → 回调里 `ctx.scale(dpr)`、拦截 fillText、`ctx.region`。v7 的 6 张卡走这条路径，作为回归依据。
限制：跨域图片无 CORS 会污染画布 → 捕获后该内容走静态并发 `warning`；视频只取当前帧；SVG 需固有尺寸；先 `img.decode()`；纯图片用 `alt` 作 aria-label。

### 3.2 DOM 元素（beta）
1. 放进不可见插槽测量，等 `document.fonts.ready` 与图片 decode。
2. 深拷贝并内联非默认计算样式、伪元素、表单值、canvas→img。
3. 图片与 CSS `url()` 用 CORS 转 data URL；@font-face 内联 base64；跨域样式表读取失败则退系统字体并 warning。
4. `<svg><foreignObject>` 光栅化，读 1 像素检测污染。
5. 活元素加 `.forma-ghost` 放到卡片矩形上作交互层（文字/背景透明，媒体 opacity:0）。
6. 逃生口：`rasterize: async (el,{width,height,dpr}) => canvas`。
限制：快照（无 hover/动画）；跨域资源需 CORS；不支持 iframe、闭合 shadow root、fixed/sticky；Safari 部分 CSS 有差异或污染 → 走静态；单次 20–100ms；建议 <1500 节点。

### 3.3 JSON
normalize → `document.fonts.load`（1.5s 超时）→ 纵向排版 → 逐块绘制（基线对齐整数设备像素）→ regions。图片按 ratio 占位，加载后再 `show` 一次（局部液浪）；超高底部裁切加渐隐；结果确定性（差异包围盒与回归测试的前提）。

## 4. 不同尺寸之间的变换

| 情形 | 做法 | 时长 |
|---|---|---|
| 液团 → 卡片 | v7 mode 1 | 1.5s |
| 卡片 → 液团 | v7 mode −1 | 1.35s |
| 同尺寸、整体不同 | v7 mode 3 | 1.55s |
| 同尺寸、局部差异 | 液浪限制在差异包围盒（外扩 8px） | 0.5–0.9s |
| 尺寸不同、并集 ≤ 0.8N | 并集变换 | 约 1.7s |
| 尺寸不同、超预算 | 收回再成形 | 约 2.9s |
| 减少动态 | 直接到终态，250ms 权重淡入 | 0.25s |

**并集变换**：`uCard` 取新旧外包矩形 U，两张纹理带偏移 `uOffA/uOffB`；液浪前沿公式同 v7（`rel` 相对 U）：A 有 B 有 → mode 3；仅 A → 前沿经过时流回剩余液团；仅 B → 前沿到达时从液团流出；都无 → 剩余液团。`uPool` 随进度插值，权重保持 `uHwBlob`。完成后 `uCard` 切到 B。A、B 同尺寸同偏移时与 v7 mode 3 逐字一致。
交互：变换开始清选区、隐藏交互层；落定 +0.25s 显示；局部液浪只隐藏相交元素。
几何：剩余液团半径 `r·cbrt(1−frac)`；容器宽而矮时放卡片右侧；N 只在 resize/换档时重算。

## 5. 画质分级与降级

| 档位 | renderScale | 空闲 fps | 其他 |
|---|---|---|---|
| high | min(DPR, 2) | 60 | 与 v7 一致 |
| medium | min(DPR, 1.5) | 30 | 落定叠层 |
| low | 1 | 30 | 落定叠层、关高光扫过 |
| static | — | — | 无 WebGL |

档位边界第 2 周第 1 天实测后定。N 随 renderScale² 缩放，`uHwBlob` 自动守恒。
- **落定叠层**：renderScale < DPR 时，落定后叠一层原生 DPR 内容画布，保证文字锐利（代价：无鼠标拨动）。
- **检测**：`failIfMajorPerformanceCaveat` 失败而去掉后成功 → 软件渲染 → static；无 WebGL2 或无 float/half_float 渲染目标 → static；触屏从 medium 起步；有 `KHR_parallel_shader_compile` 就用。
- **调速器**：变换期间最近 45 帧 p75 > 刷新间隔 ×1.3 → 下次落定降一档；不自动升档；按 renderer+屏幕尺寸存 localStorage（try/catch）；显式 `quality` 优先。
- **上下文丢失**：立即静态显示；恢复后用保留的 Frame（LRU 3 份）重建，直接进入落定。
- **静态降级**：Frame canvas + CSS 圆角阴影；CSS 液团；250ms 淡入缩放；交互层与 GL 路径相同。
- **减少动态**：冻结 uTime；关拨动、吸出、扫光；过渡改 250ms 权重淡入（`uFade`）；倒计时 150ms 交叉淡入。
- **长时间运行**：帧循环零分配；交互层 visibility 只在状态改变时写；超过 1 小时在下次变换时 t0 归零；device-pixel-content-box ResizeObserver 合并到一次 rAF；resize 只重光栅当前内容；`destroy()` 后资源计数归零；建议每页 ≤2 个活动实例。

## 6. 无障碍与交互
- 容器 `role="region"`、可配 `aria-label`；成形中 `aria-busy`；heading/list 映射 ARIA；图片用 `alt`。
- 文字：透明 span、`white-space:pre`、scaleX 校正；`::selection` 主题色；复制得到真实文字。
- 按钮链接：真实 `<button>`/`<a rel="noopener noreferrer">`，`:focus-visible` 焦点环，Tab 顺序与视觉一致；`action` 事件可 `preventDefault()` 阻止跳转。
- 指针相对容器；按下时关闭吸出；组件不抢焦点，Esc 不处理。
- 主题：一组 uniform（背景两色、阴影、env 墙/地/地平线与灯箱、墨色）+ 排版色 + 卡片渐变。light = v7 原值；dark：卡片 #1b1e25→#14161b，文字 #eef1f6 / #a3abba / #6f7889。切主题重光栅并整卡液浪。

## 7. 第 2–4 周构建计划

**第 2 周：抽取引擎、容器化、尺寸**
1. 周一：v7 基线 fps（Mac / Windows 核显 / iPhone / 中端 Android）；着色器迁入 `gl/`，拆 renderer/loop；可注入时钟；Playwright 黄金帧（落定帧逐位一致，过渡帧容差 2/255）。演示：模块化版本跑 20 秒演示与参考逐帧一致。
2. 周二：挂到任意 div、指针相对容器、独立 ResizeObserver、`destroy()` 资源计数、Promise。演示：一页两个实例。
3. 周三：`sources/canvas.js`。演示：自己的照片和 canvas 成形。
4. 周四：Frame 驱动几何、并集变换、超预算收回再成形。演示：三种尺寸互相变换。
5. 周五：交互层通用化 + 明暗主题 + `background`。演示：海报按钮可点可 Tab，文字可复制，切主题出液浪。

**第 3 周：JSON、局部变换、DOM**
6. 周一二：JSON 来源全套。演示：JSON playground，v7 六张卡用 JSON 重写并排对比。
7. 周三：差异包围盒 + `uWaveRect` + countdown。演示：倒计时只有数字处翻液浪。
8. 周四五：DOM 来源 beta。演示：Tailwind 价格卡成形，按钮可点。

**第 4 周：稳健性、封装、发布**
9. 周一：画质档位、叠层、调速器、暂停、空闲 30fps。
10. 周二：上下文丢失、静态降级、减少动态、无 WebGL2 检测。
11. 周三：React/Vue 封装 + 3 个模板（产品首屏、AI 答案卡、发布倒计时）。
12. 周四：演示站 + 文档（API、JSON 参考、给 AI 的提示词片段、限制、许可）。
13. 周五：2 小时浸泡测试、跨浏览器检查、构建 ESM/UMD/d.ts、0.9.0-beta。

**落后时砍除顺序**：DOM 来源推迟（保留 `rasterize` 钩子）→ 并集变换改为收回再成形 → chart line → poster surface。**不砍**：黄金帧测试、落定像素一致、交互层、静态降级、上下文丢失处理。

## 8. 主要风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | 重构中外观漂移 | 固定 v7 哈希；外观数值集中在 look.js；黄金帧每天跑；改外观须用户确认 |
| 2 | 填充率：DPR2 约 1M 液滴，核显和手机难达 60fps | 先实测定档；renderScale 主旋钮；空闲降帧、视口外暂停；后备 k×k 液滴或液团液滴抽稀 |
| 3 | 并集变换收尾闪动或缝隙 | 半天时间盒 + 逐帧差分，不达标只保留收回再成形 |
| 4 | DOM 光栅在 Safari 等浏览器的怪癖 | beta、单独入口、单份内容走静态、`rasterize` 钩子、写清限制 |
| 5 | webfont 未加载导致错位 | `document.fonts.load`；scaleX 校正；跨浏览器对齐测试 |
| 6 | 小数 DPR、亚像素偏移、CSS transform 破坏像素一致 | device-pixel-content-box、亚像素校正、debug 自检、文档说明 |
| 7 | 移动端无 float 渲染目标、DPR 3 | 探测失败进静态；renderScale 上限 2 + 叠层；iOS 16/17/18 实测 |
| 8 | 长时间运行精度、泄漏、倒计时漂移 | 时间归零、资源登记表、浸泡测试、倒计时按 `Date.now()` 对齐整秒 |
| 9 | AI 输出质量差 | 宽容修复、可回传的 issue、提取首个完整 `{…}`、提示词示例、多模型回归样例 |
| 10 | 不可信内容安全 | 不接受 HTML、textContent、URL 白名单、远程图片默认关、大小上限 |
| 11 | 一人三周排期紧 | 约 3k 行零依赖、砍除顺序写死、每周五检查 |
| 12 | 多实例超上下文上限 | 建议 ≤2 活动实例、视口外暂停、共享上下文推迟到 1.1 |
