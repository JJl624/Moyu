# Moyu Android

Android 10 及以上。笔记编辑器、Markdown 解析、引用重写、保存队列和差异视图复用桌面代码；手机界面位于 `src/mobile`，存储和系统交互由 Java 适配。安卓版不包含代码运行环境和终端。

本机启动：双击仓库根目录的 `start-android.cmd`，或运行 `npm run start:android`。脚本打开模拟器窗口，安装最新 Release APK 并启动应用；已运行的同名模拟器会复用，更新安装保留笔记。可用 `--apk` 指定安装包、`--avd` 指定模拟器。

启动前检查虚拟化加速；不可用时会显示配置要求，避免启动后立即退出。Windows 可启用“Windows 虚拟机监控程序平台”并重启以使用加速。`--accel auto|on|off` 分别表示自动选择、要求加速或显式尝试软件模拟，本机配置的 `acceleration` 也可设置这些值。软件模式不保证兼容所有系统镜像，运行较慢，等待上限为 10 分钟。Windows 管理员可运行 `scripts/enable-android-acceleration.ps1` 启用该组件；脚本不自动重启，也不改动模拟器数据。

模拟器配置位于不提交到 Git 的 `android/emulator.local.json`：`sdk` 为 SDK 目录，`emulator` 为模拟器可执行文件，`avdHome` 为 AVD 所在目录，`userHome` 为 Android 用户目录，`avd` 为模拟器名称。不填写本机配置时，使用 Android 环境变量和标准安装位置。

安装 JDK 17 及以上、Android SDK Platform 36 和 Build Tools 35.0.0，设置 `JAVA_HOME`、`ANDROID_HOME`，在仓库根目录运行：

```sh
npm ci
npm run test:mobile
npm run dist:android
```

APK 输出到 `release/android/v<版本号>`，版本号与桌面端一致；`shared/mobile-build.json` 同时记录递增的 Android versionCode，构建时会校验版本一致。第一次构建生成 `android/signing/moyu-release.jks` 和对应的 `.properties`；请备份这两个文件，后续覆盖更新必须使用同一签名。签名文件不提交到 Git。

`node scripts/build-android.mjs --debug` 同时构建 Android 设备测试包和运行 Java 单元测试。调试应用为 `app.moyu.notes.debug`，与正式版的数据隔离。设备测试使用 `androidx.test.runner.AndroidJUnitRunner`；手机界面回归使用 Playwright，只有原生存储边界被替换。

在测试模拟器中安装调试 APK 后，可运行 `node tests/mobile-device.mjs` 检查原生保存与启动行为，运行 `node tests/mobile-device-corpus.mjs` 检查整套示例、目录层级和文件完整性。先执行 `npm run test:mobile` 时，还会生成桌面渲染对照数据，供设备语料测试逐项比较。
