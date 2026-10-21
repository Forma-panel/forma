# 流形内容编译器与粒子运行时

编译器把合法内容场景变成粒子引擎可执行的数据。它不生成事实、不调用 AI、不负责模型重试；相同内容、视图、字体和能力应生成语义等价的布局与绑定。整板编译协调回答间排版，单回答和节点编译可复用；不同分支或不同面板实例不能仅凭相同 revision 复用结果。跨 GPU 的浮点像素完全一致不作为首版承诺。

## 三种表示

| 表示 | 产生者 | 内容 |
| --- | --- | --- |
| ModelSceneDraft | 模型或本地内容构造器 | 文本、数据、布局意图、素材键、动作与时间线 |
| BoardSnapshot | 宿主校验与规范化 | branchId、revision、有序 answers；每项有 answerId、draft、节点身份映射和资源权限 |
| CompiledScene | 编译器 | 布局、内容源、图块、粒子绑定、文本映射、命中、运动与资源需求 |

模型中的 id 是单个回答内的稳定逻辑键。宿主把它映射为 nodeId，映射只在当前分支权限范围内生效。同一键不得无声地改变节点类型。fieldRef、layoutRevision、GPU buffer 不出现在模型草稿中。

## 编译输入和输出

```ts
type CompileInput = {
  scene: BoardSnapshot;
  view: {
    boardInstanceId: string;
    viewEpoch: number;
    viewportCss: { width: number; height: number };
    effectiveDpr: number;
    textScale: number;
    quality: QualityProfile;
  };
  fontPackVersion: string;
  resources: ResolvedAssetRegistry;
  previous?: CompiledScene;
  signal: AbortSignal;
};

type CompiledScene = {
  key: { branchId: string; boardInstanceId: string; sceneRevision: number;
         viewEpoch: number; fontPackVersion: string };
  layout: LayoutNode[];
  fieldSources: FieldSource[];
  tileBindings: TileBinding[];
  textMap: TextMap;
  hitIndex: HitIndex;
  semantics: SemanticTree;
  motionPlan: MotionPlan;
  dirtyRegions: Rect[];
  resourcePlan: ResourcePlan;
  diagnostics: Diagnostic[];
};
```

以上是接口设计节选，不是当前已存在的 TypeScript 库。每个不透明类型在实现包中定义。编译结果描述 CPU 可重建信息；GPU 资源在 renderer 中创建，不能进入历史文件。

FieldSource 是带类型的内容来源：glyphCoverage、geometryCoverage、imageColor、mediaFrame。它保存源坐标、采样规则、版本、颜色空间及资产引用，不代表另一张直接可见的完整回答截图。

TileBinding 包含 layerId、tileCoord、nodeId、源坐标变换、裁剪、材质、有效格点掩码和覆盖关系。每个源在需要的图块复用；文字与半透明标注在不同层保留身份。

## 编译阶段

| 阶段 | 必须完成的工作 | 失败处理 |
| --- | --- | --- |
| 1 结构验证 | Schema、负载上限、字段白名单、完整 JSON | 返回可定位诊断；不分配大纹理 |
| 2 语义解析 | 唯一 ID、引用、树无环、资源权限、图表字段、时间线 | 指向节点和 JSON 路径；不修造缺失数据 |
| 3 规范化 | 缺省值、节点身份、主题角色、局部动作 | 输出完整只读快照候选 |
| 4 布局 | 流式分组、自由图形区、换行、最小可读尺寸 | 有界迭代；循环约束直接拒绝 |
| 5 内容编译 | 字形覆盖率、图表几何、路径与媒体区域 | 单个内容失效按已声明策略处理 |
| 6 图块分配 | 密度、层次、源绑定、脏区与运动计划 | 预估超预算先降非文字动态或拒绝 |
| 7 索引与语义 | 字素映射、命中、阅读顺序、动作、来源 | 与布局使用相同版本 |
| 8 准备提交 | 资源申请、上传、有界候选缓存、准备回执 | 保留旧画面；取消时释放候选 |

编译不直接修改正在显示的场景。候选依赖准备完成后生成 ready 回执；宿主提交后才将粒子绑定、命中索引和语义结构一起切换。不能先换图形再等标签或命中追上。

## 布局范围

首版布局允许 column 与 row 流式分组，以及有固定逻辑 viewBox 的 free 图形区。外部版式用 CSS 像素描述，绘制时乘有效 DPR；free 子对象采用父 viewBox 坐标，整体缩放后命中也用相同变换。

flow 子节点依次布局，不参与绝对位置竞争；absolute 子节点只允许位于 free group。顶层节点必须 flow。兄弟绘制顺序由草稿数组顺序决定，先出现者在下层。不要把任意 CSS、脚本和 DOM 样式引入协议。

flow 的 fill 使用可分配宽度，fit 使用内容测量宽度并限制在父容器内；显式宽度优先分配，row 的剩余宽度均分给 fill 子项。正文最小宽度 240 CSS px，窄于该值的 row 改为 column。自动高度按文本测量、group 子项与间距、chart 默认 280 px、普通 shape 默认 64 px、媒体已知纵横比计算；媒体尺寸未就绪时先用 16:9 占位。free group 按 viewBox 比例确定自动高度。控件另占至少 44 px 的操作区，加入布局与命中，不覆盖正文。以上为首轮规则，可通过样例校准而不能由各后端自行决定。

正文不通过整体缩小来塞入一屏。长文在逻辑页面中滚动，布局块按视口预取，命中保留内容坐标。row 在宽度不足时由预定规则改为 column，选择锚点按节点与字素保存。

## 文字链路

Unicode 文本先确定段落、脚本、字体回退和双向文本信息，再整形、测量、断行与行内重排，生成字形覆盖率。HarfBuzz 负责整形的一部分工作；字素边界、段落布局和绘制分别处理。[HarfBuzz 官方说明](https://harfbuzz.github.io/what-is-harfbuzz.html)

TextMap 同时保存原文、字素边界、字形 cluster、行框、方向和坐标变换。cluster 不能直接等同字素。复制返回原文范围，不依靠 GPU 颜色识别文字。代码节点保留空格和换行，正文换行不改变原文。

第一实验锁定一个合法授权字体包，覆盖中文、拉丁文、数字及混合标点。组合字符、emoji、连字、RTL 分别列为测试项目，通过后才声明支持。字体变化使相应内容场、布局及命中全部失效。

内容区的选择、光标、搜索标记也生成粒子绑定。语义桥提供辅助技术所需的真实文本和控件，但不能使用 display:none 或 aria-hidden 把内容从辅助技术树移除，也不能产生可见的文字覆盖与原生选区。具体方案需用读屏实测。

## 密集粒子的真实表示

ParticleId 由 boardEpoch、layerId、tileCoord、cellIndex 构成，运动池还包含 generation 防止句柄复用。它能解析到位置、覆盖率、颜色源、所属节点和稀疏属性覆写。

驻留格点由索引和源变换求值，默认不保存逐格点速度。解析格点光栅化仍要计算粒子足迹、源绑定、排除状态及覆盖率；不得直接把源纹理当最终输出。

逻辑图层最多 8 层、图块初始 64 或 128 绘制像素是实验预算，遇到更深叠加明确返回资源诊断。相交透明层不能合成后丢弃可编辑归属。首版不承诺所有图层都满屏分配。

运行时提供以下诊断接口，用于证明粒子不是仅对普通帧缓冲重新命名：

```ts
inspectParticle(id): ParticleInspection
overrideParticles(region, { offset?, color? }): OverrideHandle
releaseParticles(region, motion): MotionHandle
restoreParticles(handle): void
```

移动粒子时在原层记录排除位；自由绘制在新位置输出同一身份。图块更新同时覆盖旧位置和新位置，下层按正常合成恢复。恢复驻留时撤销覆写和排除，不能双重贡献。

首版动画以节点变换、共享流场和稀疏运动为主。全屏百万单元碰撞、全局最优匹配、视频光流驱动不进入基线。

## 运行时帧调度

每帧只进行需要的步骤：接收已提交版本 → 采样动画时钟 → 更新运动池 → 接收合时媒体帧 → 更新脏图块 → 粒子合成 → 发布 presented 回执。没有动画、视频或输入时可停止绘制。

动画引起的节点变换同步应用于命中。粒子正在跨区域成形时，首版暂缓该节点精确激活并提供粒子态忙碌反馈，直到它到位；不会在最终位置尚为空白时提前响应点击。播放控件与停止入口始终可用。

窗口尺寸、DPR、字体、缩放或质量档变化递增 viewEpoch，触发必要重编译，不产生新模型回答。旧 viewEpoch 的交互与未提交编译产物丢弃。若内容已经 committed，则保留新语义版本，释放旧编译产物，按当前 viewEpoch 重编译；期间保留旧有效画面，成功后仅报告 presented，不新建内容事务。切换时恢复阅读锚点和焦点，而非跳回页首。

## 增量编译

首版网络协议可提交完整草稿，编译器仍通过稳定逻辑键比较内容，只重建受影响节点。节点删除同时处理旧图块、引用、命中与语义。首版不开放任意 JSON Patch。

依赖键包括节点内容、父布局、字体包、主题、资源版本、viewEpoch 和影响布局的相邻节点。修改一段文字可能使后文移位，不能只标记这一段自己的旧矩形。

视频帧、局部悬停和播放时钟不重新运行全文布局。图表数据变化使几何、刻度、标签和命中一起失效。图表样式切换在同一数据源上重新编译表达。

用户正在选择文本或拖动控件时，冲突候选先暂存；无冲突内容可以另行提交。首版单候选实现可以延后整笔事务，最多等待 5 秒后撤销候选并请求重基，避免无限积压；该值为设计缺省，可配置。

## 资源预算与降级

把绘制像素、占用格点、活动运动粒子、透明层、纹理字节和解码帧数分别计量。3,840,000 个格点不意味着要创建同样数量的 JavaScript 对象。

初始配置以可见内容场 128 MiB、候选与显示合计 256 MiB、自由与运动池 8k/32k/64k 三档进行实验；这些仅是应用分配策略候选，不是硬件安全值或浏览器总显存测量。纹理实际分配前按格式、尺寸和 mip 层精确核算，设备 limits 同时约束。

降级依次减少液态计算、运动池、动画频率和视频尺寸，再处理非文字采样。正文密度不足时增加字号或减少视口内容。所有后端都保持粒子最终输出；无合规后端时由外壳报告兼容问题。

## 媒体接口

编译器只生成媒体区域、字幕布局和控制绑定。media 管线按 mediaId、seekEpoch、timestamp 向颜色源投递帧，不把每帧视频重新变成一个 BoardSnapshot。

初始解码队列最多 3 帧；重复 seek 撤销旧任务并关闭旧帧。所有权从解码器转交渲染消费方，消费完成或丢弃时释放；GPU 工作尚未安全消费的资源按后端实际生命周期保留。

音频或单调时钟决定媒体时间；落后时丢弃过期画面，暂停后停止无用解码。WebCodecs 之外仍需容器解复用和播放调度。[WebCodecs 官方说明](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)

## 恢复和错误

错误分成结构错误、语义错误、能力不支持、预算超限、资源缺失、编译取消和设备丢失。所有诊断包含 code、nodeKey、path、severity 和可解释信息，不把底层异常堆栈当用户文案。

设备丢失时清空 GPU 资源，从已提交快照、字体、资产和本地播放状态重建；不重复调用模型或付费生成服务。用户可以继续复制已提交内容，外壳显示恢复状态。恢复失败保留内容与导出入口。

## 编译器完成标准

固定输入下能产生可解释的布局、图块与命中；每个可见对象都可追踪到语义来源。移动一个选定粒子后原处缺口与新处贡献正确，下层无残影；关闭粒子输出并清缓存后全部回答内容消失。

文字复制与图表选择在滚动、缩放、字体变化、动画暂停和版本更新后保持正确。无效输入不污染当前场景，取消释放候选，设备恢复不重复外部任务。详细跨设备验收见 DELIVERY.md。
