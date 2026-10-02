# 测试执行与数据隔离

`TC-001` 至 `TC-073` 的编号以[追溯工作簿](../outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)为准。每个编号在 `scripts/test-cases.mjs` 中有一个入口，可用同一脚本重复执行。多个旧 TC 可以共享覆盖较广的测试；TC-021 保留共享测试并新增独立分页单元及 Electron 函数，TC-073 有独立回归函数；M6 自动用例 TC-050–071 各自绑定以该编号开头的测试函数。新增用例时，同步增加注册项和断言。

工作簿另已分配 TC-074 作为聚合上报归属授权回归，目前**未注册、不可执行**；计划命令及隔离数据见[逐项验收](test-case-acceptance.md#tc-074-聚合上报设备与用户归属授权回归2026-10-03-规划)。当前 `npm run test:cases:check` 仍只核对 73 个已注册编号。

M5 的 `TC-030` 至 `TC-049` 及 CSV 修复用例 `TC-029` 已绑定自动测试；[逐项验收](test-case-acceptance.md#m5-用例绑定与覆盖tc-030tc-049)列出实际断言和仍需验证的边界。`npm run test:cases:check` 当前核对 49 个入口；测试代码存在并不自动表示真实安装、非回环部署或目标 Mac 人工验收通过。

M6 的 `TC-050` 至 `TC-071` 已注册自动入口；最终提交 `6223c30` 的 `npm run test:acceptance -- 50 71` 摘要为 22/22 退出码 0。`TC-072` 已注册人工清单，**没有目标 Mac 通过证据**。新增 TC-073 后，`npm run test:cases:check` 现核对 73 个入口；`f7fcdee` 的 TC-021 单编号运行四个绑定函数。自动测试结果只覆盖[逐项验收](test-case-acceptance.md)列明的断言，不代替真实权限操作、安装与外部分发。

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

`test:gate` 依次运行类型检查、用例注册检查、全部 Vitest 测试和构建后的 Electron Playwright 测试。自动用例失败则命令返回非零。涉及打包行为的变更还需运行打包应用端到端测试，并保留实际命令与结果。`TC-021` 单编号运行两项单元和两项 Electron；`TC-030` 和 `TC-038` 各运行单元与 Electron 两层测试；`TC-048`、`TC-049` 运行 Electron 测试。

`test:acceptance` 逐编号调用同一个单用例运行器，把输出写入被 Git 忽略的 `test-results/acceptance/TC-###.log`，并生成 `summary.json`（提交、时间、平台、Node、每条退出码和日志文件名）。任何编号失败时批量命令非零退出。该摘要只证明所运行的自动断言；TC-027/028 的真实机器安装、签名和公证以及 TC-072 的真实 Mac 权限操作仍须按人工入口另留证据。固定开发提交前的临时运行结果不得当作最终验收记录。

人工用例也使用 `npm run test:case -- TC-001` 这样的命令读取操作清单。完成后用 `npm run test:case -- TC-001 pass /绝对路径/脱敏证据文件` 记录结果；失败时改用 `fail`。缺少证据、尚未操作时命令返回非零。记录写入被 Git 忽略的 `test-results/manual/`，不能把真实会话正文、凭证或用户数据库提交到仓库。`TC-029` 已改成自动断言；`TC-028` 的签名、公证及另一台 Mac 验收仍需真实发布环境。

## 测试数据库

所有单元测试通过 `tests/support/test-workspace.ts` 在系统临时目录创建各自独立的 `token.sqlite`。M6 的 TC-050–071 按编号使用 `token-test-db-tc###-*` 专用目录；Electron 端到端测试将对应目录作为 `--token-user-data`，Codex/Claude 人工构造样本目录均在其中。每次测试结束清理目录；测试不得指向真实用户数据目录，也不得以真实会话正文造数。

## 每次功能交付

1. 依据变更范围在追溯工作簿中维护 REQ、DEV、TC 关联，并修改或新增相应测试及 `scripts/test-cases.mjs` 注册项。
2. 用 `npm run test:case -- TC-XXX` 单独运行受影响用例，再运行 `npm run test:gate`。适用的人工或打包验收也须执行。
3. 在交付说明中记录用例编号、命令、结果、环境和未通过项。相关用例未通过时，不把功能标记为交付完成。
