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
- 同一请求、重复扫描、文件替换/截断、遥测重复批次不能增加用量。`src/main/report.ts` 当前以提供方+UTC 日期有本地事实就排除当日全部遥测，已用隔离 SQLite 复现不同用户独立遥测误丢失；`src/main/usage-sync.ts` 另有同日排除 SQL，静态核对发现服务上报亦受影响。REQ-048/DEV-057/TC-092–094 均待修复或注册，不能包装成完整覆盖。新目标先按授权 owner 筛选，只对有共同稳定事件身份等可证重复去重；仅同会话不足以证明逐事件重复，疑似重叠标冲突。报表/CSV/服务快照须共用调和版本，并显示“已确认小计”和“总量不可确认”及授权范围内冲突条数，不能把小计称作总 Token；旧服务不兼容时保留待传并明确提示，不改 Codex/Claude 计量与原始事实。
- CSV 兼容口径：当前无冲突 v1 固定十列，TC-029 现行源码已断言十列；工作簿旧“九列”是历史描述。DEV-057 待实现的冲突 v2 必须显式标识十四列，前十列顺序不变、冲突行原数值列空、末四列按时间桶/提供方/模型/项目组给状态、已确认小计、白名单来源和候选条数；不得在多行重复全查询小计。TC-093 验两个冲突组，TC-023/079 须回归两版。现有本地与 OTel 没有共同事件 ID，TC-092 不能用近似时间/Token 制造“已证重复”。
- 服务 v2 旧值边界：历史 v1 聚合/覆盖及旧客户端继续上传的值须标 `legacy/unverified`；同设备成功接收 v2 后拒绝任何 v1（包括更高 revision），拒绝时聚合、状态、覆盖和 revision 不变。只在授权 v2 重新调和并原子替换后，按证据标 `confirmed` 或 `uncertain`；TC-094 以隔离历史库验证迁移、旧 v1 追加、v2 重算、v1 回滚和 owner 范围。当前只是设计，不能把旧服务聚合标为完整。
- viewer 来源状态边界：`sources:statuses` 和 `ReportService.query().coverage` 当前把全局 `scanner.statuses()` 返回给普通用户，概览/报表会显示全局记录数和采集时间；这是 REQ-048/DEV-057/TC-093 的待修复静态发现。主进程必须按当前登录态和授权查询范围生成计数、时间、状态和诊断细节；不能只在渲染层隐藏。来源级证据无法证明归属时用未知/空值，不把全局 `ready`、零或最近扫描时间当作 viewer 自己的覆盖。TC-093 要以双 owner 合成数据直调 IPC 并核 UI；当前未动态复现或验收。
- viewer 诊断边界：`sources:diagnostics` 当前只按 provider 筛选整条全局诊断，`feedback:submit` 可选附件也复用该范围，可能含其他 owner 的计数、时间和原因。TC-093 必须同时验诊断 IPC/页面和隔离反馈载荷；可保留通用修复建议，本人不可证的字段须未知/省略。勾选附件不能扩大授权读取范围。当前仍为静态发现，未实现或验收。
- 来源归属必须显式绑定；普通用户的查询范围由主进程登录态约束。每个 IPC 在主进程验证发送方、权限和参数；预加载脚本只暴露命名方法，不能暴露通用 IPC、文件系统或 SQL。
- 只保存用量字段和必要的来源元数据。禁止提交真实会话 JSONL、提示词、回复、源码、数据库、凭证和遥测密钥；测试使用人工构造的无正文样本，临时数据目录在测试后清理。
- 遥测接收器只监听本机地址并验证随机密钥。只读检查已有 Codex/Claude 配置，不自动覆盖既有或组织管理设置。CSV 文本字段必须防公式注入。
- `REQ-014` 的历史 CSV 表头错位由 `DEV-019` / `TC-029` 自动断言覆盖；每次修改导出结构时重跑该编号与公式注入用例 TC-023。
- `REQ-013` / `DEV-013` 的 TC-021 在 `f7fcdee` 增加跨页验证：`tests/report-pagination.test.ts` 核对 123 条事实的 50/50/23 分页、去重、合计、普通用户授权和第二页筛选；`tests/e2e/report-pagination.spec.ts` 以合成 Codex `turn_context` 模型和 61 条记录核对界面第二页、切换模型后重置页码。改动报表分页、筛选或权限时运行 `npm run test:case -- TC-021`；原共享测试仍保留，实际覆盖见[逐项验收](test-case-acceptance.md#tc-021-筛选与分页明细)。TC-047 的跨用户服务授权仍未由该用例验证。
- `REQ-021` 的修复前跨用户覆盖缺口见[设计第 12.1 节](design.md)；`ca0f37f` 实现 DEV-048 的管理密钥登记、独立设备上报令牌和服务端用户范围校验，`3d60b5e` 再以配置代次检查修复服务切换竞态。TC-074 在隔离服务/客户端有四项绑定，TC-047 增加自签 HTTPS 本机鉴权。改动上传协议、凭据、服务地址或授权范围时运行 `npm run test:case -- TC-074`、TC-047 及 TC-038–040；`533992e` 只修复 TC-047 测试清理。0.3.4 是历史本机候选，当前代码版本为 0.3.5；可信证书与异机 HTTPS 尚未验证，详见[验收记录](validation.md)。
- TC-032 / TC-047 的临时 CA 严格 TLS 补证已由测试提交 `57fd884` 注册：前者在本机非回环 IPv4 验证证书链、SAN 主机名、无 CA 与错误主机名的拒绝，并通过 `NODE_EXTRA_CA_CERTS` 检查真实 `ServerConnection`；后者在严格连接上验证清单/包、管理登记、设备上报与 owner 范围鉴权。单编号分别 2/2、3/3；改动服务地址、TLS 或鉴权时复跑两项。原关闭证书校验的自签测试保留为历史证据；临时 CA 的本机结果不证明生产证书、系统信任设置或异机部署，见[设计第 11 节](design.md)与[逐项验收](test-case-acceptance.md)。
- `REQ-006` 的 Codex fallback 跨扫描重复计数缺陷已由 `DEV-047` 在 `aa6d91b` 修复，`7abd640` 再修复无 fallback 大会话启动时的重复相关查询；`TC-073` 现绑定原归并与 6000 条合成事实性能回归两项。修改旧库清理、扫描器构造或 Codex 事实查询时独立运行 `npm run test:case -- TC-073`，并按规模风险运行打包应用副本检查。`TC-010` 的既有历史结果与本次回归分别保留。0.3.1 隔离同库升级历史见[设计第 4.5–4.6 节](design.md)和[逐项验收](test-case-acceptance.md#tc-073-当前实现与验收2026-10-03)；0.3.3 包不含性能修复。
- M5 的 `TC-030`–`TC-049` 已有单编号入口；受信设备、独立服务、十分钟扫描、聚合上报及界面有相应测试。TC-036 在 `44a96e8`、`b224dde` 的本机隔离证据仅验证旧版下载打开、外部脚本替换及取消。`86a4b5b` 的 0.3.5 已加入受约束更新 helper，TC-036 两项合成单元和 TC-076 实际打包成功链路由文档会话复跑通过；TC-076 的模拟旧版仅从 0.3.5 包修改版本元数据，并非真实历史 0.3.4/0.3.0 二进制。原 0.3.0/0.3.4 UI 不会自动调用新 helper；真实旧版首次迁移、只读 DMG、打包版故障回滚仍待验证。TC-028 签名公证与目标 Mac 独立待验，详见[设计第 11 节](design.md#11-独立本地服务与更新)和[逐项验收](test-case-acceptance.md#m5-用例绑定与覆盖tc-030tc-049)。
- 下一轮三批打磨已规划 REQ-040–047 / DEV-049–056 / TC-077–091；其中 REQ-041/DEV-050/TC-079 在 `78b3a3b` 的查询导出子范围已通过，REQ-042/DEV-051/TC-080–081 在 `d18bb47` 的概览下钻子范围已通过；其余六条需求与十二个用例仍待开发或注册；本地与遥测重叠缺陷另用 REQ-048 / DEV-057 / TC-092–094。开发前先按[设计第 20 节](design.md#20-下一轮三批产品打磨req-0400472026-10-03-计划)核对可证来源时间窗、今天 as-of、数据库快照身份、角色授权、重绑事务和目标 Mac 人工证据；上报版本 2 还需验旧服务安全拒绝、旧 outbox、设备令牌范围、隐私白名单与 TC-088 状态区别。每项必须有独立临时库和单编号绑定。SOP 指导所有模型行为，本指南只列工程事实。
- M6 的 REQ-031–039、DEV-034–046 已在 v0.3.0 本机实现，TC-050–071 在最终代码 `6223c30` 有逐编号自动结果；TC-072 已注册人工清单但目标 Mac 权限验证未完成。项目归属只从 Codex/Claude 会话 cwd 提取，当前仅保存哈希项目键与展示名，聚合、反馈和诊断外发不得含完整路径或本机项目身份。固定 `admin` 的库角色仍为 `admin`，仅精确用户名和库角色同时符合时对外派生 `superadmin`；旧管理员权限和冲突迁移规则见设计第 18 节。自动结果与剩余边界见[逐项验收](test-case-acceptance.md)，后续改动先按 SOP 核对阶段条件并复验受影响编号。
- 本机 0.3.5 候选 DMG 未签名；SHA-256 `ae1b8e80ec69c43f76e93d1e2312694cb4faab3521115fdaeec9e304d6e697fd`，`hdiutil verify` VALID。开发会话报告本机服务目录已发布同哈希包与清单，并在备份生产用户数据后用 0.3.5 helper 人工接管旧 0.3.0 安装；只读数据库完整性为 `ok`，真实账号/报表人工验收仍待做。0.3.4 是不含自动更新 helper 的历史候选；签名、公证和目标设备验收仍须单独完成。

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
| 外部分发签名 DMG | `npm run pack:signed`；需有效 Developer ID 和公证凭据，真实发布结果按 TC-028 验收 |
| 独立启动更新与聚合服务 | `npm run server`（默认 `127.0.0.1:47839`） |
| 发布更新包 | `npm run publish:update -- <dmg> <version> <arch> <server-dir>` |
| 本机隔离升级复验 | `npm run test:upgrade:local -- /绝对路径/旧版.dmg /绝对路径/新版.dmg` |
| 生产库副本启动复验 | `npm run test:production-copy -- /绝对路径/token.sqlite /绝对路径/Token.app` |
| Codex fallback 同库升级复验 | `npm run test:upgrade:local -- /绝对路径/Token-0.3.0.dmg /绝对路径/Token-0.3.1.dmg --fallback-repair` |
| M6 批量逐编号验收 | `npm run test:acceptance -- 50 71` |
| 目标 Mac 人工权限验收清单 | `npm run test:case -- TC-072` |
| 签名脚本自动回归（已注册） | `npm run test:case -- TC-075`；覆盖预检、合成 p12、命令构造与五处模拟核验失败/清理；真实发布仍按 TC-028 |
| 自动升级实际制品回归（已注册） | `npm run test:case -- TC-076`；0.3.5 合成旧版成功链路通过，真实历史旧版/故障边界仍待验 |
| 下一轮产品打磨与重叠缺陷（计划） | `TC-079` 在 `78b3a3b` 单元/Electron 各 1/1 通过；`TC-080/081` 在 `d18bb47` 各一项 Electron 通过；`TC-077–078`、`TC-082–094` 未注册，按工作簿实施独立绑定 |

服务端监听地址由 `TOKEN_SERVER_HOST`、`TOKEN_SERVER_PORT` 配置，非回环监听还需 `TOKEN_SERVER_TLS_CERT` 和 `TOKEN_SERVER_TLS_KEY`。App 连接地址与密钥可配置；非回环连接必须使用 HTTPS。更新清单、安装包和反馈提交使用全局 bearer；聚合上报使用经管理凭据登记的独立设备令牌；反馈管理读取和状态修改另需独立管理密钥。不要提交服务密钥、管理密钥、设备令牌、证书私钥、反馈正文或服务数据库。
