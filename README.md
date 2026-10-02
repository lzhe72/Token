# Token

Token 是一个 macOS 桌面应用，用于汇总本机 Codex 与 Claude Code 的 Token 消耗，并按用户、工具、模型和时间查看报表。

项目文档：

- [文档总览与维护顺序](docs/README.md)
- [需求、开发任务与测试追溯工作簿](outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)
- [Codex 项目技术指南](docs/agent.md)
- [产品与技术设计](docs/design.md)
- [开发计划与验收标准](docs/development-plan.md)
- [M0 本机数据可行性验证](docs/feasibility.md)
- [验收记录（首版与 M5）](docs/validation.md)
- [项目变更日志](docs/CHANGELOG.md)

第一版定位为本机离线应用。M5 增加独立服务，用于更新包和已归属用量的聚合快照；默认在本机 `127.0.0.1:47839` 通信，监听与连接地址可配置。跨设备同步与云端账户管理仍不在当前验收范围内。

## 当前进度

- M0：验证了本机 Codex 和 Claude Code 用量记录的可采集性。
- M1：完成 Electron 应用骨架、本地管理员与普通用户、受控 IPC。
- M2：完成 Codex 与 Claude Code 本地记录的历史导入、增量扫描、去重和来源归属；可选接收官方 OTLP/HTTP JSON 遥测。
- M3：完成日、周、月、年报表、工具、模型、用户、时区筛选与 CSV 导出。
- M4：完成数据库备份/恢复、打包版 Playwright 测试和未签名 DMG；已在当前 Mac 从 DMG 复制应用运行验收。面向其他 Mac 分发仍需签名、公证和对应设备验收。
- M5：已实现可选“信任此设备”、每 10 分钟扫描后聚合上报、独立服务版本清单与安装包下载、K→M→P 显示，以及概览和趋势图修复。版本提交 `96e99be` 的 TC-029–049 自动验收为 21/21；真实新版本安装发布、签名公证和另一台 Mac 安装仍待人工验收，详细限制见[逐项验收](docs/test-case-acceptance.md)。

## 使用流程

1. 首次启动创建本地管理员账户；登录时可主动勾选“信任此设备”，手动退出会撤销信任。
2. 应用启动时扫描当前 macOS 账户可读取的 `~/.codex/sessions` 与 `~/.claude/projects`，之后每 10 分钟扫描；管理员可在“数据来源”页立即扫描、查看采集/上报状态并把来源绑定到应用用户。完整扫描后向配置的独立服务上传聚合快照。
3. 在“用量报表”页选择日期、日/周/月/年、工具、模型、用户和统计时区。点击趋势柱或模型名称可追溯分页明细；页面按 1024 逐级使用 K→M→P 显示，明细单元格的悬浮提示提供精确原值，CSV 直接保留原始 Token 整数。
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
npm run test:acceptance -- 29 49
```

独立服务可用 `npm run server` 启动；默认监听 `127.0.0.1:47839`，可用 `TOKEN_SERVER_HOST`、`TOKEN_SERVER_PORT`、`TOKEN_SERVER_DATA_DIR` 配置。非回环监听须配置 `TOKEN_SERVER_TLS_CERT` 和 `TOKEN_SERVER_TLS_KEY`，App 的非回环连接须使用 HTTPS。更新清单、安装包和聚合上报都需要服务 bearer 密钥。将已准备好的 DMG 放入服务发布目录可执行 `npm run publish:update -- <dmg> <version> <arm64|x64> <server-dir>`；此命令不替代签名、公证和目标 Mac 安装验证。

打包目录位于 `release/mac/Token.app`。当前构建未签名，仅用于本机开发验证。
当前应用版本为 `0.2.0`；`npm run pack:dmg` 在项目根目录生成 `Token-0.2.0.dmg`。该包未签名；公开分发前需在具备 Apple 开发者证书的环境中签名、公证并在目标 Mac 验收。
