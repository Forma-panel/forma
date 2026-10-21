# Forma

一行代码，让你的应用界面像液体一样流动成形。

开发中。工程规格见 [docs/SPEC.md](docs/SPEC.md)，外观基准见 `reference/v7.html`。

## 本地开发

```bash
npm run serve          # 在 forma 目录起本地服务
```

打开 http://127.0.0.1:8765/dev/index.html （加 `#demo` 自动播放 20 秒演示）。

## 黄金帧测试

外观红线：新引擎在同一时刻的画面必须与 v7 逐像素一致。

```bash
npm run test:golden    # 需要先 npm run serve
```
