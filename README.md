# 墨屿 Moyu

本地 Markdown 编辑器，支持预览编辑、源码与阅读视图，以及绘图、公式、代码运行和 WebDAV 同步。

[下载 Windows / Linux / Android 版](https://github.com/JJl624/Moyu/releases/latest) · [问题反馈](https://github.com/JJl624/Moyu/issues)

启动时自动检查更新，每天最多一次，也可在偏好设置底部手动检查。可关闭自动检查。Windows 替换 EXE，Linux 替换 AppImage 或安装 DEB，Android 安装 APK；文档和应用数据保留。

## 开发

需要 Windows 或 Linux、Node.js 24 和 Git。

```sh
npm ci
npm run build
npm test
npm start
```

首次构建会下载并校验运行环境。修改界面使用 `npm run dev`；Windows 打包使用 `npm run dist:win`，Linux 使用 `npm run dist:linux`。Linux 需安装编译工具、GTK 3、NSS、ALSA 和 Fontconfig；图形测试使用 Xvfb。

MIT License。第三方组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
