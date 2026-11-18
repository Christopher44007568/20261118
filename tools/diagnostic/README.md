# 诊断脚本（开发期探针）

本目录保存开发过程中用于定位问题的一次性 Puppeteer 探针，不属于交付
运行路径。正式的无头验证与截图入口是上一级的 `tools/capture.js`：

```bash
CHROME=/path/to/chrome node tools/capture.js          # 桌面
CHROME=/path/to/chrome node tools/capture.js --mobile # 移动
```

探针依赖 `http://127.0.0.1:8765` 上运行的本地静态服务器（`npm run serve`）。
