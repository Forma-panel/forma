# 流形协议设计样例

此目录是 panel-scene/0.3 内部设计契约，供后续独立开发编译器、宿主和适配器使用。它不是应用程序，也不声明已完成纯粒子渲染。

## 文件

- scene-draft.schema.json：模型内容草稿，禁止模型填写宿主版本与可执行代码。
- host-transaction.schema.json：宿主生成的提交信封，包含回答范围和权威版本。
- examples/text.json：可复制的中文与混合文本。
- examples/chart.json：标明为演示数据的三年柱状图及本地动作。
- examples/motion-media.json：几何动画与媒体资产绑定。
- examples/host-transaction.json：完整、可校验的追加回答事务。
- examples/resource-registry.json：样例资源身份；没有提供实际媒体文件。
- validate.py：结构与部分语义的参考检查器及对抗性案例。
- requirements.txt：参考检查器依赖。Python 不属于应用运行时设计。

## 运行

在项目根目录创建独立环境：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r specs/requirements.txt
.venv/bin/python specs/validate.py
```

当前预期结果是 2 份 Schema、5 个正向案例和 24 个被拒绝的反例。第 5 个正向案例是检查器内的中间回答恢复：从 A、C 恢复成 A、B、C，不会错误追加到末尾。

检查器验证未知字段、重复身份、父图无环、布局约束、数据字段与值、动作目标、动画端点、素材和来源引用，以及版本递增、过期基线和插入锚点。JSON Schema 使用 2020-12，外部引用通过本地 registry 解析，不联网读取规格。

它没有实现生产权限、宿主事务持久化、去重存储、请求流解析、资产解析、字体整形、渲染或并发控制。通过这些检查不代表画面正确、来源真实或输入已被安全授权。完整实现仍按 [开发验收](../docs/DELIVERY.md) 执行。

## 契约使用规则

协议文档与 Schema 一起修改，不把样例当作所有边界的穷尽定义。模型只能提交 SceneDraft，宿主填充事务字段；前端编译结果不反向写成模型事实。运行时预算可以比 Schema 上限更低，并通过能力协商明确告知。

新增节点类型或动作需同时定义语义、粒子显示方式、命中与无障碍、资源释放以及降级行为。不能只因为模型能输出新 JSON 就宣布支持该能力。

