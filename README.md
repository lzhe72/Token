# Token

Token 是一个 macOS 桌面应用，用于汇总本机 Codex 与 Claude Code 的 Token 消耗，并按用户、工具、模型和时间查看报表。

项目文档：

- [文档总览与维护顺序](docs/README.md)
- [需求、开发任务与测试追溯工作簿](outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)
- [Codex 项目技术指南](docs/agent.md)
- [产品与技术设计](docs/design.md)
- [开发计划与验收标准](docs/development-plan.md)
- [M0 本机数据可行性验证](docs/feasibility.md)
- [验收记录（首版、M5 与 M6）](docs/validation.md)
- [项目变更日志](docs/CHANGELOG.md)

第一版定位为本机离线应用。M5 增加独立服务，用于更新包和已归属用量的聚合快照；默认在本机 `127.0.0.1:47839` 通信，监听与连接地址可配置。跨设备同步与云端账户管理仍不在当前验收范围内。

## 当前进度

- M0：验证了本机 Codex 和 Claude Code 用量记录的可采集性。
- M1：完成 Electron 应用骨架、本地管理员与普通用户、受控 IPC。
- M2：已实现 Codex 与 Claude Code 本地记录的历史导入、增量扫描、去重和来源归属；可选接收官方 OTLP/HTTP JSON 遥测。`aa6d91b` 修复了 Codex fallback 先入库、正式记录后到的重复计数，REQ-006 / DEV-047 / TC-073 的本机代码验收通过；0.3.1 本机未签名候选包已补验同库升级修复，0.3.0 包仍不含此变更。
- M3：完成日、周、月、年报表、工具、模型、用户、时区筛选与 CSV 导出。
- M4：完成数据库备份/恢复、打包版 Playwright 测试和未签名 DMG；已在当前 Mac 从 DMG 复制应用运行验收。面向其他 Mac 分发仍需签名、公证和对应设备验收。
- M5：已实现可选“信任此设备”、每 10 分钟扫描后聚合上报、独立服务版本清单与安装包下载、K→M→P 显示，以及概览和趋势图修复。版本提交 `96e99be` 的 TC-029–049 自动验收为 21/21；`44a96e8` 验证了 0.2.0→0.3.0 本机隔离更新交接和应用替换，`b224dde` 补验取消替换后旧版及数据可用、注入式打开失败不替换旧文件。Finder 安装失败回退、手动拖拽、生产库迁移、签名公证及另一台 Mac 仍待验证，详见[逐项验收](docs/test-case-acceptance.md)。
- M6：v0.3.0 增加按会话工作目录识别本机项目、项目/模型分析、固定侧栏与面包屑、集中设置、权限指引、采集诊断、反馈及固定 `admin` 超管。最终提交 `6223c30` 的 TC-050–071 自动验收为 22/22；TC-027 的 0.3.0 本机未签名 DMG 复制版人工验收通过。TC-072 目标 Mac 文件权限操作、生产数据迁移、签名公证和外部分发仍待验证，详见[逐项验收](docs/test-case-acceptance.md)。
- 0.3.1 本机候选：`867a03a` 将版本升至 0.3.1，重建未签名 x64 DMG；隔离升级验收中，旧版 0.3.0 同库 1280→2560 Token 重复计数升级后修复为 1280，受信登录保持。本机更新服务目录已发布该包及版本清单；实际生产账户 App 连接/安装、生产库迁移、Finder `/Applications` 手动安装、签名公证和目标 Mac 未验证，见[验收记录](docs/validation.md)。
- 0.3.2 阶段候选：`ca0f37f` 实现 DEV-048 的设备上报令牌与用户范围校验；`533992e` 只补 TC-047 测试清理。随后发现服务切换竞态，0.3.2 不作为最新交付版本。
- 0.3.3 本机候选：`3d60b5e` 为 TC-074 补配置代次检查和服务切换竞态回归，四项绑定通过；未签名 x64 DMG 已核验并发布到本机更新服务目录。实际生产账户/数据库、Finder `/Applications`、可信证书、异机 HTTPS、签名公证和目标 Mac 仍待验，见[验收记录](docs/validation.md)。
- 0.3.4 本机候选：`7abd640` 修复大 Codex 会话下启动时 fallback 旧库修复扫描过慢的问题；TC-073 增加 6000 条合成事实的独立回归。打包应用在生产库的隔离副本上启动并核对完整性及账户、事实、来源、游标数量，未修改原库。TC-027 的当前 Mac 隔离挂载、复制和主流程子范围已登记人工 `pass`；未签名 x64 DMG 与本机更新服务目录已对账。Finder `/Applications`、真实生产账户安装、目标 Mac 和签名公证仍待验，见[验收记录](docs/validation.md)。
- 后续测试提交 `57fd884` 为 TC-032、TC-047 增加临时 CA 的本机严格 TLS 断言，单编号分别 2/2、3/3；0.3.4 产品代码与 DMG 未变。生产证书、异机 HTTPS 和系统信任配置仍待验，见[逐项验收](docs/test-case-acceptance.md)。
- `dc37b8b` 已实现独立 `pack:signed` 和 TC-075 自动预检，后者单编号 1/1 通过；无公证凭据时签名入口在构建前拒绝。当前尚无真实已签名公证包或目标 Mac 验收，TC-028 仍待验证。现有 `pack:dmg` 继续是本机未签名通道，见[设计第 7 节](docs/design.md#7-发布与测试边界)。

## 使用流程

1. 首次启动创建固定用户名 `admin` 的本地超级管理员账户；登录时可主动勾选“信任此设备”，手动退出会撤销信任。旧库的普通管理员继续保留原权限。
2. 应用启动时扫描当前 macOS 账户可读取的 `~/.codex/sessions` 与 `~/.claude/projects`，之后每 10 分钟扫描；管理员可在“数据来源”页立即扫描、查看采集/上报状态并把来源绑定到应用用户。完整扫描后向配置的独立服务上传聚合快照。
3. 在“用量报表”页选择日期、日/周/月/年、工具、项目、模型、用户和统计时区。点击趋势柱、项目或模型可追溯分页明细；页面按 1024 逐级使用 K→M→P 显示，明细单元格的悬浮提示提供精确原值，CSV 直接保留原始 Token 整数。项目键与展示名留在本机，完整工作目录不进入服务端聚合或反馈。
4. 在“系统设置”查看服务器、更新与文件访问指引，在“采集诊断”定位漏采；用户可预览并提交脱敏问题反馈，管理员在“管理中心”查看反馈、账号和采集状态。管理员仍可备份 SQLite 数据库或从备份恢复；恢复会先保存当前数据库副本，再重启应用。

## 可选官方遥测

“系统设置”页提供 Codex 与 Claude Code 的本机遥测配置片段，并只读检查现有用户设置，发现已有遥测配置时提示核对。接收器只监听 `127.0.0.1:43188`，要求每次请求带安装时生成的随机密钥，并只保存用量字段。配置片段含密钥，只在管理员登录后显示；不要共享。应用不会修改现有工具设置或组织管理配置。

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
npm run test:acceptance -- 50 71
npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.2.0.dmg /Users/lz/文档/Token/Token-0.3.0.dmg
npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.3.0.dmg /Users/lz/文档/Token/Token-0.3.1.dmg --fallback-repair
npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.3.1.dmg /Users/lz/文档/Token/Token-0.3.2.dmg
npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.3.2.dmg /Users/lz/文档/Token/Token-0.3.3.dmg
npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.3.3.dmg /Users/lz/文档/Token/Token-0.3.4.dmg
npm run test:production-copy -- /绝对路径/token.sqlite /绝对路径/Token.app
```

独立服务可用 `npm run server` 启动；默认监听 `127.0.0.1:47839`，可用 `TOKEN_SERVER_HOST`、`TOKEN_SERVER_PORT`、`TOKEN_SERVER_DATA_DIR` 配置。非回环监听须配置 `TOKEN_SERVER_TLS_CERT` 和 `TOKEN_SERVER_TLS_KEY`，App 的非回环连接须使用 HTTPS。更新清单、安装包继续使用服务全局 bearer；聚合上报须先由全局密钥和管理密钥登记设备，再使用签发的设备令牌。远端首次登记需管理员配置管理密钥。将已准备好的 DMG 放入服务发布目录可执行 `npm run publish:update -- <dmg> <version> <arm64|x64> <server-dir>`；此命令不替代签名、公证和目标 Mac 安装验证。

打包目录位于 `release/mac/Token.app`。当前构建未签名，仅用于本机开发验证。
当前应用版本为 `0.3.4`；`npm run pack:dmg` 在项目根目录生成 `Token-0.3.4.dmg`。本机未签名 x64 候选包大小 142555479 字节，SHA-256 为 `7b4d8ad523c5afe71f5004fc7d7b4e690144e1f1119af2ab7bb86635888bf588`，`hdiutil verify` 为 VALID；本机更新服务目录的 `Token-0.3.4-x64.dmg` 与清单同哈希。隔离 0.3.3→0.3.4 升级通过，取消安装时旧版数据保留。历史 0.3.3 包不含大会话启动性能修复；生产库仅以临时副本启动验证，未进行实际生产账户安装。公开分发前需签名、公证并在目标 Mac 验收。
