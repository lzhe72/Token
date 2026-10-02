# Codex 项目技术指南

更新日期：2026-10-03。本指南记录 Token 仓库的技术边界。根目录 `AGENTS.md` 是 Codex 的自动发现入口；需求和验证编号见[追溯工作簿](../outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)。

**项目 SOP 指导大模型在本项目中的所有行为**，包括需求、设计、开发、测试、发布、维护及跨阶段交接。开始任何项目任务前先阅读[项目 SOP](sop/README.md)和对应章节，遵守其步骤与退出条件；本指南只补充仓库技术事实，不能替代或降低 SOP 要求。SOP 文件由独立的 SOP 会话维护；非 SOP 文档及[项目变更日志](CHANGELOG.md)由文档会话维护。

## 仓库地图

| 路径 | 职责 |
| --- | --- |
| `src/collectors/codex.ts`、`claude.ts` | 本地记录解析和提供方专属 Token 口径 |
| `src/collectors/scanner.ts` | 只读扫描、增量游标、去重入库、状态及来源绑定 |
| `src/collectors/project.ts` | 从会话 cwd 推导本机项目键与展示名，原始路径不入库或外发 |
| `src/main/auth.ts`、`database.ts` | 账户和权限、`sql.js` SQLite 文件持久化与备份 |
| `src/main/telemetry.ts` | 可选本机 OTLP 接收、密钥验证及遥测归并 |
| `src/main/trusted-device.ts`、`server-connection.ts`、`update-client.ts`、`usage-sync.ts` | 受信凭证、本地/配置服务连接、更新包校验与聚合上报 |
| `src/server/` | 独立服务、版本清单与安装包、聚合接收和鉴权 |
| `src/main/report.ts` | 筛选、时区分桶、明细和 CSV 的统一计算口径 |
| `src/main/feedback.ts`、`src/renderer/feedback.tsx`、`diagnostics.tsx`、`settings.tsx` | 本机反馈待传、诊断与设置界面 |
| `src/main/index.ts`、`src/preload/index.ts`、`src/shared/types.ts` | 主进程 IPC、最小化预加载 API、跨进程类型 |
| `src/renderer/` | React 界面、报表交互与样式 |
| `tests/*.test.ts`、`tests/e2e/*.spec.ts` | 规则测试和 Electron 端到端流程 |
| `docs/` | 设计、计划、证据及本指南 |

## 不可破坏的规则

- 第一版为本机离线用量观察工具。统计口径是可观察数据，不是服务商账单或完整跨设备用量。缺失、权限不足、格式未知要显示覆盖状态，不能默认为零。
- Codex 缓存读取属于输入子集，推理输出属于输出子集；优先采用来源总量，不能重复加总。Claude Code 的输入、输出、缓存读取和缓存写入是四类相加。两套口径有独立的测试证据。
- 同一请求、重复扫描、文件替换/截断、遥测重复批次不能增加用量。当前报表在同一提供方同一 UTC 日存在本地记录时优先本地记录；这可能低估部分覆盖日。
- 来源归属必须显式绑定；普通用户的查询范围由主进程登录态约束。每个 IPC 在主进程验证发送方、权限和参数；预加载脚本只暴露命名方法，不能暴露通用 IPC、文件系统或 SQL。
- 只保存用量字段和必要的来源元数据。禁止提交真实会话 JSONL、提示词、回复、源码、数据库、凭证和遥测密钥；测试使用人工构造的无正文样本，临时数据目录在测试后清理。
- 遥测接收器只监听本机地址并验证随机密钥。只读检查已有 Codex/Claude 配置，不自动覆盖既有或组织管理设置。CSV 文本字段必须防公式注入。
- `REQ-014` 的历史 CSV 表头错位由 `DEV-019` / `TC-029` 自动断言覆盖；每次修改导出结构时重跑该编号与公式注入用例 TC-023。
- `REQ-006` 的 Codex fallback 跨扫描重复计数缺陷已由 `DEV-047` 在 `aa6d91b` 修复，`TC-073` 已注册并在该提交上本机通过；`TC-010` 的既有历史结果与本次回归分别保留。修复在 `src/collectors/scanner.ts` 的扫描事务与扫描器启动修复中，独立测试见 `tests/collector-fallback.test.ts`；`867a03a` 的 0.3.1 本机未签名候选包又通过隔离 0.3.0→0.3.1 同库修复场景。实际边界见[设计第 4.5 节](design.md#45-codex-fallback-修复实现与边界2026-10-03)和[逐项验收](test-case-acceptance.md#tc-073-当前实现与验收2026-10-03)。历史 0.3.0 DMG 不含此代码。
- M5 的 `TC-030`–`TC-049` 已有单编号入口；受信设备、独立服务、十分钟扫描、聚合上报及界面有相应测试。TC-036 有 `44a96e8` 的本机隔离 0.2.0→0.3.0 更新交接与替换证据，`b224dde` 又验证隔离取消后旧版及数据可用、注入式打开失败时不替换旧文件；实际 Finder 安装失败回退、手动安装、生产数据迁移、目标 Mac 和签名公证仍待验。自动化的实际覆盖与缺口见[逐项验收](test-case-acceptance.md#m5-用例绑定与覆盖tc-030tc-049)。
- M6 的 REQ-031–039、DEV-034–046 已在 v0.3.0 本机实现，TC-050–071 在最终代码 `6223c30` 有逐编号自动结果；TC-072 已注册人工清单但目标 Mac 权限验证未完成。项目归属只从 Codex/Claude 会话 cwd 提取，当前仅保存哈希项目键与展示名，聚合、反馈和诊断外发不得含完整路径或本机项目身份。固定 `admin` 的库角色仍为 `admin`，仅精确用户名和库角色同时符合时对外派生 `superadmin`；旧管理员权限和冲突迁移规则见设计第 18 节。自动结果与剩余边界见[逐项验收](test-case-acceptance.md)，后续改动先按 SOP 核对阶段条件并复验受影响编号。
- 本机 0.3.1 候选 DMG 未签名；SHA-256 `7e56933298505f5d08def3811b891e187b6cefb264bfab3538e5accdb6235a7c`。本机更新服务目录已发布同哈希包及清单，实际生产账户 App 连接/安装、签名、公证和目标设备验收仍须单独完成。

## 常用命令

环境：macOS、Node.js 24、npm。

| 目的 | 命令 |
| --- | --- |
| 安装依赖 | `npm ci` |
| 开发启动 | `npm start` |
| 类型检查 | `npm run typecheck` |
| 单元测试 | `npm test` |
| Electron 端到端 | `npm run test:e2e` |
| 打包目录 | `CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir` |
| 打包应用端到端 | `npm run test:e2e:packaged` |
| 本机未签名 DMG | `npm run pack:dmg` |
| 独立启动更新与聚合服务 | `npm run server`（默认 `127.0.0.1:47839`） |
| 发布更新包 | `npm run publish:update -- <dmg> <version> <arch> <server-dir>` |
| 本机隔离升级复验 | `npm run test:upgrade:local -- /绝对路径/旧版.dmg /绝对路径/新版.dmg` |
| Codex fallback 同库升级复验 | `npm run test:upgrade:local -- /绝对路径/Token-0.3.0.dmg /绝对路径/Token-0.3.1.dmg --fallback-repair` |
| M6 批量逐编号验收 | `npm run test:acceptance -- 50 71` |
| 目标 Mac 人工权限验收清单 | `npm run test:case -- TC-072` |

服务端监听地址由 `TOKEN_SERVER_HOST`、`TOKEN_SERVER_PORT` 配置，非回环监听还需 `TOKEN_SERVER_TLS_CERT` 和 `TOKEN_SERVER_TLS_KEY`。App 连接地址与密钥可配置；非回环连接必须使用 HTTPS。更新清单、安装包、聚合上报与反馈提交都需要 bearer 密钥；反馈管理读取和状态修改另需独立管理密钥。不要提交服务密钥、管理密钥、证书私钥、反馈正文或服务数据库。
