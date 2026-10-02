# Token

Token 是一个 macOS 桌面应用，用于汇总本机 Codex 与 Claude Code 的 Token 消耗，并按用户、工具、模型和时间查看报表。

项目文档：

- [产品与技术设计](docs/design.md)
- [开发计划与验收标准](docs/development-plan.md)
- [M0 本机数据可行性验证](docs/feasibility.md)
- [首版验收记录](docs/validation.md)

第一版定位为本机离线应用。账户、采集结果和报表存储在当前 Mac；跨设备同步与云端管理不在第一版范围内。

## 当前进度

- M0：验证了本机 Codex 和 Claude Code 用量记录的可采集性。
- M1：完成 Electron 应用骨架、本地管理员与普通用户、受控 IPC。
- M2：完成 Codex 与 Claude Code 本地记录的历史导入、增量扫描、去重和来源归属；可选接收官方 OTLP/HTTP JSON 遥测。
- M3：完成日、周、月、年报表、工具、模型、用户、时区筛选与 CSV 导出。
- M4：完成数据库备份/恢复、打包版 Playwright 测试和未签名 DMG；已在当前 Mac 从 DMG 复制应用运行验收。面向其他 Mac 分发仍需签名、公证和对应设备验收。

## 使用流程

1. 首次启动创建本地管理员账户。
2. 应用自动扫描当前 macOS 账户可读取的 `~/.codex/sessions` 与 `~/.claude/projects`，每 30 秒检查新记录。管理员可在“数据来源”页立即扫描、查看采集状态并把来源绑定到应用用户。
3. 在“用量报表”页选择日期、日/周/月/年、工具、模型、用户和统计时区。点击趋势柱或模型名称可追溯分页明细；报表每 15 秒刷新，可导出当前筛选结果的 CSV。
4. 管理员可在“数据来源”页保存 SQLite 备份，或从备份恢复。恢复会先保存当前数据库副本，再重启应用。

## 可选官方遥测

“数据来源”页提供 Codex 与 Claude Code 的本机遥测配置片段，并只读检查现有用户设置，发现已有遥测配置时提示核对。接收器只监听 `127.0.0.1:43188`，要求每次请求带安装时生成的随机密钥，并只保存用量字段。配置片段含密钥，只在管理员登录后显示；不要共享。应用不会修改现有工具设置或组织管理配置。

- Codex：将页面中的 `[otel]` 配置合并到 `~/.codex/config.toml`。若已有 `[otel]` 段或其他导出目标，先人工核对，不要重复添加。
- Claude Code：在启动 Claude Code 的终端设置页面列出的环境变量。若已有 OTLP 指标目标或受管理设置，请先人工核对。
- 本地记录与遥测同一提供方、同一 UTC 日期有重叠时，报表优先使用本地记录，不叠加遥测。此规则避免明显重复，但当本地记录只覆盖该日一部分时可能低估；来源页分别显示本地与遥测记录数。

配置依据：[Codex OpenTelemetry](https://learn.chatgpt.com/docs/config-file/config-advanced)、[Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)。

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
npm run pack:dmg
```

打包目录位于 `release/mac/Token.app`。当前构建未签名，仅用于本机开发验证。
DMG 位于项目根目录 `Token-0.1.0.dmg`，也未签名。公开分发前需在具备 Apple 开发者证书的环境中签名和公证。
