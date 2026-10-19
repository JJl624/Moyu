# 墨屿 Moyu

本地 Markdown 编辑器，支持预览编辑、源码与阅读视图，以及绘图、公式、代码运行和 WebDAV 同步。

[下载 Windows x64 版](https://github.com/JJl624/Moyu/releases/latest) · [问题反馈](https://github.com/JJl624/Moyu/issues)

启动时自动检查更新，每天最多一次；也可在偏好设置底部点击“检查更新”。退出程序后，用 Release 中的新版 EXE 替换原文件，文档和应用数据保留。

## 开发

需要 Windows x64、Node.js 24 和 Git。

```sh
npm ci
npm run build
npm test
npm start
```

首次构建会下载并校验运行环境。修改界面可使用 `npm run dev`；生成便携版使用 `npm run dist:win`。

MIT License。第三方组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
