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
- 0.3.5 自动更新：`86a4b5b` 已由应用校验下载包，退出旧版后交辅助进程原位替换并启动新版；TC-034/035/059 的自动子范围、TC-036 两项单元及 TC-076 的合成旧版打包成功链路已通过。TC-076 把同一 0.3.5 包改版本元数据模拟旧版，不是真实 0.3.4/0.3.0 二进制；原 0.3.0/0.3.4 按钮仍只会下载打开 DMG。真实旧版首次过渡、只读 DMG 与打包版故障回滚待补证，见[逐项验收](docs/test-case-acceptance.md)。
- 0.3.6 本机候选（`1e70412` 历史批次）：代码 `1e70412` 的 TC-076 已在独立临时用户数据和可写安装目录，用**真实 0.3.5 DMG 二进制旧 UI**完成下载、自动退出、替换并重启 0.3.6；受信登录和合成 1280 Token 报表延续。两包哈希与 DMG 校验见[验收记录](docs/validation.md)。尚未从只读 DMG 直接启动、安装到实际 `/Applications`/`~/Applications` 或在打包 App 上注入故障回滚；0.3.6 未签名候选未上传生产更新服务。
- 2026-10-04 候选补证：代码 `80e7f10` 修复健康检查的 `/var`/`/private/var` 路径别名；只读旧 DMG 已能直接启动初始界面，真实 DMG 的生产 installer 模块五类故障回退在隔离可写路径逐项核过。文档会话独立 TC-036 2/2、门禁和打包版 38/38 通过；TC-076 最后重试的状态文件消费竞态导致整条命令退出码 1，修复前不得登记全套通过。上条“未直接启动”对应 `1e70412` 历史批次；系统安装目标、打包 helper/UI 故障、安装中取消仍待验，见[验收记录](docs/validation.md)。
- `0eac84b` 已修 TC-076 状态文件一次性读取竞态；文档会话同包完整复跑退出码 0。前条退出码 1 保留为 `80e7f10` 阶段失败，当前通过仍限隔离安装及生产 installer 模块故障，见[验收记录](docs/validation.md)。
- REQ-040–048/TC-077–094 的 94 个编号目前均已注册入口；页面/CSV 同快照、下钻、引导、空状态、来源重绑、服务状态、遥测调和、键盘访问和精确 Token 复制各有隔离自动子范围证据。历史完整覆盖与真零（[受管来源设计决议](docs/coverage-evidence-decision.md)）、目标 Mac VoiceOver、生产数据及外部分发仍按[设计第 20 节](docs/design.md#20-下一轮三批产品打磨req-0400472026-10-03-计划)和[逐项验收](docs/test-case-acceptance.md)单独判定。
- M6：v0.3.0 增加按会话工作目录识别本机项目、项目/模型分析、固定侧栏与面包屑、集中设置、权限指引、采集诊断、反馈及固定 `admin` 超管。最终提交 `6223c30` 的 TC-050–071 自动验收为 22/22；TC-027 的 0.3.0 本机未签名 DMG 复制版人工验收通过。TC-072 目标 Mac 文件权限操作、生产数据迁移、签名公证和外部分发仍待验证，详见[逐项验收](docs/test-case-acceptance.md)。
- 0.3.1 本机候选：`867a03a` 将版本升至 0.3.1，重建未签名 x64 DMG；隔离升级验收中，旧版 0.3.0 同库 1280→2560 Token 重复计数升级后修复为 1280，受信登录保持。本机更新服务目录已发布该包及版本清单；实际生产账户 App 连接/安装、生产库迁移、Finder `/Applications` 手动安装、签名公证和目标 Mac 未验证，见[验收记录](docs/validation.md)。
- 0.3.2 阶段候选：`ca0f37f` 实现 DEV-048 的设备上报令牌与用户范围校验；`533992e` 只补 TC-047 测试清理。随后发现服务切换竞态，0.3.2 不作为最新交付版本。
- 0.3.3 本机候选：`3d60b5e` 为 TC-074 补配置代次检查和服务切换竞态回归，四项绑定通过；未签名 x64 DMG 已核验并发布到本机更新服务目录。实际生产账户/数据库、Finder `/Applications`、可信证书、异机 HTTPS、签名公证和目标 Mac 仍待验，见[验收记录](docs/validation.md)。
- 0.3.4 本机候选：`7abd640` 修复大 Codex 会话下启动时 fallback 旧库修复扫描过慢的问题；TC-073 增加 6000 条合成事实的独立回归。打包应用在生产库的隔离副本上启动并核对完整性及账户、事实、来源、游标数量，未修改原库。TC-027 的当前 Mac 隔离挂载、复制和主流程子范围已登记人工 `pass`；未签名 x64 DMG 与本机更新服务目录已对账。Finder `/Applications`、真实生产账户安装、目标 Mac 和签名公证仍待验，见[验收记录](docs/validation.md)。
- 后续测试提交 `57fd884` 为 TC-032、TC-047 增加临时 CA 的本机严格 TLS 断言，单编号分别 2/2、3/3；0.3.4 产品代码与 DMG 未变。生产证书、异机 HTTPS 和系统信任配置仍待验，见[逐项验收](docs/test-case-acceptance.md)。
- `dc37b8b` 已实现独立 `pack:signed`，`2f43b00` 为 TC-075 补四项制品核验和 Developer ID 身份检查的模拟失败/清理回归；单编号 1/1 通过。无公证凭据时签名入口在构建前拒绝。当前尚无真实已签名公证包或目标 Mac 验收，TC-028 仍待验证。现有 `pack:dmg` 继续是本机未签名通道，见[设计第 7 节](docs/design.md#7-发布与测试边界)。

## 使用流程

1. 首次启动创建固定用户名 `admin` 的本地超级管理员账户；登录时可主动勾选“信任此设备”，手动退出会撤销信任。旧库的普通管理员继续保留原权限。
2. 应用启动时扫描当前 macOS 账户可读取的 `~/.codex/sessions` 与 `~/.claude/projects`，之后每 10 分钟扫描；管理员可在“数据来源”页立即扫描、查看采集/上报状态并把来源绑定到应用用户。完整扫描后向配置的独立服务上传聚合快照。
3. 在“用量报表”页选择日期、日/周/月/年、工具、项目、模型、用户和统计时区。点击趋势柱、项目或模型可追溯分页明细；页面按 1024 逐级使用 K→M→P 显示，并提供可用键盘操作的原始 Token 整数复制按钮；CSV 保留原始整数。项目键与展示名留在本机，完整工作目录不进入服务端聚合或反馈。
4. 在“系统设置”查看服务器、更新与文件访问指引，在“采集诊断”定位漏采；用户可预览并提交脱敏问题反馈，管理员在“管理中心”查看反馈、账号和采集状态。管理员仍可备份 SQLite 数据库或从备份恢复；恢复会先保存当前数据库副本，再重启应用。

## 可选官方遥测

“系统设置”页提供 Codex 与 Claude Code 的本机遥测配置片段，并只读检查现有用户设置，发现已有遥测配置时提示核对。接收器只监听 `127.0.0.1:43188`，要求每次请求带安装时生成的随机密钥，并只保存用量字段。配置片段含密钥，只在管理员登录后显示；不要共享。应用不会修改现有工具设置或组织管理配置。

- Codex：将页面中的 `[otel]` 配置合并到 `~/.codex/config.toml`。若已有 `[otel]` 段或其他导出目标，先人工核对，不要重复添加。
- Claude Code：在启动 Claude Code 的终端设置页面列出的环境变量。若已有 OTLP 指标目标或受管理设置，请先人工核对。
- 当前报表、明细、CSV 与聚合上报按授权用户和会话保留可证独立事实；疑似重叠标为待核对，完整总量不可确认。REQ-048/TC-092–094 的隔离自动子范围已验证，真实生产库迁移和共同事件身份的正向精确去重仍待验；未观察到来源记录不能解释为已确认零或完整覆盖。

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
当前代码版本为 `0.3.6`；本机未签名 x64 候选 `Token-0.3.6.dmg` 大小 142591838 字节，SHA-256 `d99d7af9a67e35a92199335eebc5d1aaa5ece2c902a7898f4747847b3ec54a9c`，文档会话核对 `hdiutil verify` 为 VALID。原 142591767 字节、`27aae018…` 候选仅对应 `1e70412` 历史批次。当前候选位于开发工作树，未上传生产更新服务，未替换生产 App 或数据库；公开分发前仍需 Developer ID 签名、公证及其他目标 Mac 验收。历史包与本机人工接管证据见[验收记录](docs/validation.md)。
