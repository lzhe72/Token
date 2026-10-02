# Token

Token 是一个计划中的 macOS 桌面应用，用于汇总本机 Codex 与 Claude Code 的 Token 消耗，并按用户、工具、模型和时间查看报表。

项目文档：

- [产品与技术设计](docs/design.md)
- [开发计划与验收标准](docs/development-plan.md)
- [M0 本机数据可行性验证](docs/feasibility.md)

第一版定位为本机离线应用。账户、采集结果和报表存储在当前 Mac；跨设备同步与云端管理不在第一版范围内。

## 当前进度

- M0：验证了本机 Codex 和 Claude Code 用量记录的可采集性。
- M1：完成 Electron 应用骨架、本地管理员与普通用户、受控 IPC。采集器和报表仍在开发中。

## 开发运行

要求：macOS、Node.js 24、npm。目标测试机不需要完整 Xcode。

```bash
npm ci
npm start
```

```bash
npm run typecheck
npm run test:e2e
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
npm run test:e2e:packaged
```

打包目录位于 `release/mac/Token.app`。当前构建未签名，仅用于本机开发验证。
