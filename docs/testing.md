# 测试执行与数据隔离

2026-10-04 新增 TC-095 当前 Mac 实际安装/可用人工用例，已于 `c359e6a` 在 `scripts/test-cases.mjs` 注册 manual 入口；下文“94 个编号均有入口”是新增前的固定代码状态。现可单独运行 `npm run test:case -- TC-095` 获取手工清单，再以已存在的绝对路径脱敏证据文件登记 `pass|fail`。自动测试仅用隔离用户数据，不能写现有生产目录。详见[本机验收](local-mac-acceptance.md)。

`TC-001` 至 `TC-095` 的编号以[追溯工作簿](../outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)为准。`c359e6a` 已为全部 95 个编号在 `scripts/test-cases.mjs` 注册入口；人工清单有入口不等于已通过。多个旧 TC 可共享覆盖较广的测试；TC-021 保留共享测试及独立分页单元/Electron，TC-073 包含 fallback 归并与 6000 条合成事实性能，TC-074 包含设备授权和服务切换竞态。新增用例时，同步增加注册项和断言。

2026-10-04 TC-076 新增 `scripts/verify-auto-upgrade-faults.mjs` 绑定；真实 DMG 模式需四个 `TOKEN_TC076_*` 路径/摘要环境变量。不带真实包时故障脚本跳过，不能从命令退出码推断真实故障已验。代码 `80e7f10` 的文档会话独立运行曾在最终重试读取一次性状态文件处退出码 1；已观察的五种 installer 模块故障回退不等于整条 TC-076 或打包 helper/UI 故障闭环通过。详见[逐项验收](test-case-acceptance.md)与[验收记录](validation.md)。

`0eac84b` 修正一次性状态读取断言后，文档会话用相同真实 DMG 和固定 SHA-256 将完整 TC-076 独立复跑到退出码 0；`80e7f10` 的退出码 1 作为历史失败保留。证据仍限隔离可写路径与 installer 模块 hooks，见[验收记录](validation.md)。

TC-074 现可用 `npm run test:case -- TC-074` 单独执行；服务端设备/用户授权、客户端加密凭据及待传恢复分别有绑定，实际边界见[逐项验收](test-case-acceptance.md)。`npm run test:cases:check` 在代码 `0eac84b` 核对 94 个编号。

M5 的 `TC-030` 至 `TC-049` 及 CSV 修复用例 `TC-029` 已绑定自动测试；[逐项验收](test-case-acceptance.md#m5-用例绑定与覆盖tc-030tc-049)列出实际断言和仍需验证的边界。测试代码存在并不自动表示真实安装、非回环部署或目标 Mac 人工验收通过。

M6 的 `TC-050` 至 `TC-071` 已注册自动入口；最终提交 `6223c30` 的 `npm run test:acceptance -- 50 71` 摘要为 22/22 退出码 0。`TC-072` 已注册人工清单，**没有目标 Mac 通过证据**。目前全部 94 个编号均有入口；TC-021 单编号运行四个绑定函数，TC-076 的真实旧包路径需同时提供两个 DMG 路径及已知 SHA-256。自动测试结果只覆盖[逐项验收](test-case-acceptance.md)列明的断言，不代替真实权限操作、安装与外部分发。

## 命令

| 目的 | 命令 |
| --- | --- |
| 查看所有用例入口 | `npm run test:case -- --list` |
| 运行一个自动用例 | `npm run test:case -- TC-020` |
| 核对编号和测试绑定 | `npm run test:cases:check` |
| 按编号批量验收并留日志 | `npm run test:acceptance -- 29 49` |
| M6 批量逐编号验收 | `npm run test:acceptance -- 50 71` |
| 查看 TC-072 人工清单 | `npm run test:case -- TC-072` |
| 运行交付门禁 | `npm run test:gate` |
| 运行打包应用端到端测试 | `npm run test:e2e:packaged` |
| 生产库隔离副本启动检查 | `npm run test:production-copy -- /绝对路径/token.sqlite /绝对路径/Token.app` |

`test:gate` 依次运行类型检查、用例注册检查、全部 Vitest 测试和构建后的 Electron Playwright 测试。自动用例失败则命令返回非零。涉及打包行为的变更还需运行打包应用端到端测试，并保留实际命令与结果。`TC-021` 单编号运行两项单元和两项 Electron；`TC-030` 和 `TC-038` 各运行单元与 Electron 两层测试；`TC-048`、`TC-049` 运行 Electron 测试。

`test:production-copy` 先用 SQLite 备份把指定数据库复制到系统临时目录，再以该目录作为打包 App 的用户数据目录，传入空的 Codex/Claude 来源目录。现有 `verify-production-copy.mjs` 在 `integrity_check` 之外要求 `users`、`usage_facts`、`source_identities`、`source_cursors` 四表行数完全相等；旧库身份隔离可能按规则新增 `legacy-unverified` 身份，故单纯身份行数变化不能直接判数据损坏，也不能直接放行。TC-095 要求对身份白名单、事实逐键逐数值、归属/报表授权与兼容旧备份回退做[隔离副本验收](local-mac-acceptance.md#旧生产库身份迁移的可观察验收)。命令结束清理临时副本；只在确认目标是授权读取的数据库和正确版本的打包 App 后运行。它不代替真实生产账户安装、来源扫描或逐项报表验收。

`test:acceptance` 逐编号调用同一个单用例运行器，把输出写入被 Git 忽略的 `test-results/acceptance/TC-###.log`，并生成 `summary.json`（提交、时间、平台、Node、每条退出码和日志文件名）。任何编号失败时批量命令非零退出。该摘要只证明所运行的自动断言；TC-027/028 的真实机器安装、签名和公证以及 TC-072 的真实 Mac 权限操作仍须按人工入口另留证据。固定开发提交前的临时运行结果不得当作最终验收记录。

人工用例也使用 `npm run test:case -- TC-001` 这样的命令读取操作清单。完成后用 `npm run test:case -- TC-001 pass /绝对路径/脱敏证据文件` 记录结果；失败时改用 `fail`。缺少证据、尚未操作时命令返回非零。记录写入被 Git 忽略的 `test-results/manual/`，不能把真实会话正文、凭证或用户数据库提交到仓库。`TC-029` 已改成自动断言；`TC-028` 的签名、公证及另一台 Mac 验收仍需真实发布环境。

## 测试数据库

所有单元测试通过 `tests/support/test-workspace.ts` 在系统临时目录创建各自独立的 `token.sqlite`。M6 的 TC-050–071 按编号使用 `token-test-db-tc###-*` 专用目录；Electron 端到端测试将对应目录作为 `--token-user-data`，Codex/Claude 人工构造样本目录均在其中。每次测试结束清理目录；测试不得指向真实用户数据目录，也不得以真实会话正文造数。

## 每次功能交付

1. 依据变更范围在追溯工作簿中维护 REQ、DEV、TC 关联，并修改或新增相应测试及 `scripts/test-cases.mjs` 注册项。
2. 用 `npm run test:case -- TC-XXX` 单独运行受影响用例，再运行 `npm run test:gate`。适用的人工或打包验收也须执行。
3. 在交付说明中记录用例编号、命令、结果、环境和未通过项。相关用例未通过时，不把功能标记为交付完成。
