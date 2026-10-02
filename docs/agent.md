# Codex 项目技术指南

更新日期：2026-10-02。本指南记录 Token 仓库的技术边界。根目录 `AGENTS.md` 是 Codex 的自动发现入口；需求和验证编号见[追溯工作簿](../outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)。

**项目 SOP 指导大模型在本项目中的所有行为**，包括需求、设计、开发、测试、发布、维护及跨阶段交接。开始任何项目任务前先阅读[项目 SOP](sop/README.md)和对应章节，遵守其步骤与退出条件；本指南只补充仓库技术事实，不能替代或降低 SOP 要求。SOP 文件由独立的 SOP 会话维护；非 SOP 文档及[项目变更日志](CHANGELOG.md)由文档会话维护。

## 仓库地图

| 路径 | 职责 |
| --- | --- |
| `src/collectors/codex.ts`、`claude.ts` | 本地记录解析和提供方专属 Token 口径 |
| `src/collectors/scanner.ts` | 只读扫描、增量游标、去重入库、状态及来源绑定 |
| `src/main/auth.ts`、`database.ts` | 账户和权限、`sql.js` SQLite 文件持久化与备份 |
| `src/main/telemetry.ts` | 可选本机 OTLP 接收、密钥验证及遥测归并 |
| `src/main/trusted-device.ts`、`server-connection.ts`、`update-client.ts`、`usage-sync.ts` | 受信凭证、本地/配置服务连接、更新包校验与聚合上报 |
| `src/server/` | 独立服务、版本清单与安装包、聚合接收和鉴权 |
| `src/main/report.ts` | 筛选、时区分桶、明细和 CSV 的统一计算口径 |
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
- M5 的 `TC-030`–`TC-049` 已有单编号入口；受信设备、独立服务、十分钟扫描、聚合上报及界面有相应测试。自动化的实际覆盖与缺口见[逐项验收](test-case-acceptance.md#m5-用例绑定与覆盖tc-030tc-049)，不得以模拟包测试代替真实 macOS 安装。
- M6 的 REQ-031–039、DEV-034–046、TC-050–072 目前只有[设计](design.md)、[计划](development-plan.md)和追溯记录；新 TC 尚未注册或执行。实现项目识别时只从 Codex/Claude 会话 cwd 提取归属，完整项目路径只留本机，聚合、反馈和诊断外发均不含路径或本机项目身份。固定 `admin` 的库角色继续存 `admin`，仅该用户名与库角色同时符合时对外派生 `superadmin`；旧管理员权限和冲突迁移规则见设计第 18 节。开发任务必须先按 SOP 核对阶段条件，再补各编号独立临时库测试和单用例注册，不得把规划状态改写成通过。
- 本机开发版 DMG 未签名；公开分发的签名、公证和目标设备验收独立于本机打包通过。

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
| 批量逐编号验收 | `npm run test:acceptance -- 29 49` |

服务端监听地址由 `TOKEN_SERVER_HOST`、`TOKEN_SERVER_PORT` 配置，非回环监听还需 `TOKEN_SERVER_TLS_CERT` 和 `TOKEN_SERVER_TLS_KEY`。App 连接地址与密钥可配置；非回环连接必须使用 HTTPS。更新清单、安装包和聚合上报都需要 bearer 密钥。不要提交服务密钥、证书私钥或服务数据库。
