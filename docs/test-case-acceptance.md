# Token 测试用例逐项验收

本文逐条说明追溯工作簿中的 TC-001 至 TC-029 如何执行、实际绑定哪段测试、需要什么证据以及何时判为失败。以下命令均从仓库根目录执行，先用 `npm ci` 安装锁定依赖。用例注册以 `scripts/test-cases.mjs` 为准，执行入口为 `scripts/run-test-case.mjs`。工作簿 H/I 列保留历史验收状态和证据，不代表本轮已经复验。

## 执行与证据边界

- 共 29 条：23 条有自动运行入口，6 条为人工入口。多条编号可能运行同一测试函数，命令可单独调用，但结果并非独立断言。
- 自动入口在缺少 `TOKEN_E2E_EXECUTABLE` 时会先构建应用；Vitest 以 `-t`、Playwright 以 `--grep` 精确选择注册的测试名称。任一绑定函数失败，`npm run test:case -- TC-###` 非零退出。
- 单元和端到端造数由 `tests/support/test-workspace.ts` 在系统临时目录 `token-test-db-<label>-*` 创建：`token.sqlite`、`codex/`、`claude/` 均在其中。端到端将该目录作为 `--token-user-data`；测试结束清理。不要使用真实用户数据库或真实会话正文。
- 自动入口不会自动保存证据文件。可先执行 `mkdir -p test-results/acceptance`，再将单用例输出重定向到 `test-results/acceptance/TC-###.log`，紧接着记录退出码、提交、macOS 和测试日期。`test-results/` 已被 Git 忽略；日志只保留脱敏断言与环境信息。

例如记录 TC-020 的自动运行输出和退出码：

```bash
mkdir -p test-results/acceptance
npm run test:case -- TC-020 > test-results/acceptance/TC-020.log 2>&1
echo $?
```

- 人工入口只打印操作清单并以退出码 2 结束，不代表通过。先在 `test-results/manual/evidence/` 写入脱敏证据文件，再执行 `npm run test:case -- TC-### pass "$PWD/test-results/manual/evidence/TC-###.md"`；失败时把 `pass` 改为 `fail`。运行器会写入 `test-results/manual/TC-###.json`；缺文件或证据路径不是绝对路径时退出码 2，`fail` 的退出码为 1。
- TC-029 是已知 CSV 表头缺陷。当前运行器拒绝其 `pass`，退出码 2。历史 A1–A10 或代码中的断言不能代替当前版本、当前环境的逐项结果。

## 本次命令核对

2026-10-02，以 `origin/main` 的 `6fd695e` 代码为基线：`npm run test:cases:check` 核对了 29 个入口；`TC-003`、`TC-020` 的 Vitest 命令和 `TC-002` 的 Playwright 命令均以退出码 0 结束；对 `TC-029` 尝试登记 `pass` 得到预期的退出码 2。本次只抽跑这些命令，其余用例的本轮结果仍需各自执行并留证。

## 逐项验收

### TC-001 本机来源字段抽样

- **历史状态**：已验证（人工）；docs/feasibility.md；2026-10-02。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-001`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：当前 Mac 上可读取的 Codex 与 Claude Code 本地会话；记录工具版本、入口和样本时间段。只读检查，不复制正文到仓库。
- **验收断言或人工操作**：列出两家工具的用量字段、模型、时间、请求标识、文件覆盖数与未知项；明确可观察范围，不把缺失当零。
- **脱敏证据**：脱敏字段映射与计数、工具版本、日期；历史证据为 docs/feasibility.md，当前验收须另存新证据。
- **失败或未验证条件**：任一工具没有可核对样本或字段口径未定时保持待验证；无证据时人工入口退出码 2。
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-001 pass "$PWD/test-results/manual/evidence/TC-001.md"`，失败执行 `npm run test:case -- TC-001 fail "$PWD/test-results/manual/evidence/TC-001.md"`。

### TC-002 首次创建与重启登录

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A1。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-002`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-004、TC-005、TC-010、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：tests/e2e/app.spec.ts 使用 token-test-db-app-* 下的 token.sqlite 与人工构造 JSONL，作为 --token-user-data 启动 Electron。
- **验收断言或人工操作**：首次显示管理员创建；创建后登录进入概览；关闭重启后 owner 再登录，既有 26 Token 保留。
- **脱敏证据**：保存命令、退出码和 Playwright 脱敏日志；记录提交及 macOS 环境。
- **失败或未验证条件**：任一界面断言、重启登录或用量持久化失败时 Playwright 非零退出。

### TC-003 重复初始化和登录限速

- **历史状态**：已验证（自动）；tests/auth.test.ts；docs/validation.md A1。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-003`。
- **实际绑定**：`tests/auth.test.ts` 中 `test('首次管理员、重启后的登录和失败尝试限速')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/auth.test.ts 在 token-test-db-auth-* 建立独立 token.sqlite。
- **验收断言或人工操作**：第二次 setupAdmin 被拒绝；重新打开数据库可登录；连续五次错误密码后正确密码仍被限速拒绝。
- **脱敏证据**：保存该 Vitest 测试的命令、退出码和脱敏日志。
- **失败或未验证条件**：重复初始化未拒绝、重开不能登录或限速断言失败即非零退出。

### TC-004 用户创建与权限隔离

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A2。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-004`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-002、TC-005、TC-010、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002 共用 tests/e2e/app.spec.ts 的 token-test-db-app-* 和完整端到端函数。
- **验收断言或人工操作**：管理员创建 viewer，绑定 Codex 来源；viewer 登录后只见 12 Token 和 gpt-test，管理入口隐藏。
- **脱敏证据**：保存共享 Playwright 函数的命令与退出码；说明本编号没有独立测试函数。
- **失败或未验证条件**：用户创建、归属筛选或管理入口断言失败即非零退出。

### TC-005 管理 IPC 拒绝越权

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A2。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-005`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-002、TC-004、TC-010、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002/004 共用 tests/e2e/app.spec.ts；以 viewer 登录临时 Electron 应用。
- **验收断言或人工操作**：listUsers、getTelemetryConfiguration、backupDatabase 三项预加载 API 均返回 rejected。
- **脱敏证据**：保存共享 Playwright 函数的命令与退出码；标注三项 IPC 结果。
- **失败或未验证条件**：任一管理 IPC 对 viewer 成功或测试非零退出即失败。

### TC-006 Codex 真实样本逐条核对

- **历史状态**：已验证（人工）；docs/validation.md A3；样本已删除。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-006`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：当前 Codex 版本的两段可读取、多模型真实会话只读样本；人工按来源字段独立核算脱敏用量。仓库目前没有专用自动核算脚本。
- **验收断言或人工操作**：逐条对齐 UTC 时间、实际/未知模型、输入、输出、缓存子集及来源总量；摘要数量和值一致。
- **脱敏证据**：版本、样本数、脱敏摘要和差异为零的核对记录；2026-10-02 的 A3 样本已删除，不能复用作本轮证据。
- **失败或未验证条件**：样本缺失、任一字段不一致或无法证明模型归属时待验证或 fail；无证据时入口退出码 2。
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-006 pass "$PWD/test-results/manual/evidence/TC-006.md"`，失败执行 `npm run test:case -- TC-006 fail "$PWD/test-results/manual/evidence/TC-006.md"`。

### TC-007 Codex 模型切换

- **历史状态**：已验证（自动）；tests/collector.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-007`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('模型切换与 Claude 子代理记录按实际模型归档')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/collector.test.ts 在 token-test-db-model-switch-* 写入两轮 Codex 与 Claude 子代理的人工 JSONL。
- **验收断言或人工操作**：Codex gpt-a=12、gpt-b=8；Claude claude-a=10、claude-b=14，均为各自事实。
- **脱敏证据**：保存该 Vitest 函数的命令、退出码与四行脱敏结果。
- **失败或未验证条件**：任一模型或总量映射错误即非零退出。

### TC-008 Claude 真实样本逐条核对

- **历史状态**：已验证（人工）；docs/validation.md A4；样本已删除。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-008`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：当前 Claude Code 版本的两段多模型及子代理真实会话只读样本；记录版本和请求标识。
- **验收断言或人工操作**：逐条核对时间、模型、输入、输出、缓存读写与总量；同请求记录不重复计数。
- **脱敏证据**：脱敏逐条摘要和差异为零的核对记录；历史 A4 样本已删除，当前验收须新取样。
- **失败或未验证条件**：没有当前样本、请求归并不明或任一字段不一致时不得通过。
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-008 pass "$PWD/test-results/manual/evidence/TC-008.md"`，失败执行 `npm run test:case -- TC-008 fail "$PWD/test-results/manual/evidence/TC-008.md"`。

### TC-009 Claude 请求重复归并

- **历史状态**：已验证（自动）；tests/collector.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-009`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-010、TC-012、TC-013 共用至少一个测试函数。
- **前置与造数**：与 TC-010/012/013 共用 tests/collector.test.ts 首个函数，token-test-db-collector-* 中写入重复 Claude 消息。
- **验收断言或人工操作**：同请求 output=3/4/4 归并为一条 30 Token 事实；新 output=6 覆盖后为 32，不新增事实。
- **脱敏证据**：保存共享 Vitest 函数的命令、退出码和 1 条 Claude 事实结果。
- **失败或未验证条件**：同请求被累计为多条或未采用更新值时非零退出。

### TC-010 重复扫描和重启幂等

- **历史状态**：已验证（自动）；tests/collector.test.ts；tests/e2e/app.spec.ts；A5。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-010`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`；`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-009、TC-012、TC-013、TC-002、TC-004、TC-005、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：先跑 collector 单元函数，再跑共享的 app 端到端函数；两者各自使用 token-test-db-* 临时目录。
- **验收断言或人工操作**：重扫后事实总数仍为 2；应用重启再次扫描后页面总量仍为 26。
- **脱敏证据**：保留同一 TC 命令的两段测试日志及退出码；说明两个绑定函数均通过。
- **失败或未验证条件**：任一绑定测试非零、事实增加或重启总量改变时整条命令非零。

### TC-011 末行、截断与轮转

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/validation.md A5。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-011`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('未写完的末行等待补齐，截断重写后不重复统计')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/collector.test.ts 在 token-test-db-rotation-* 写入未完成 JSONL、截断重写与新路径文件。
- **验收断言或人工操作**：事实数按 1→1→2→3→4 变化，未完行不入库，旧响应不重复。
- **脱敏证据**：保存该 Vitest 函数命令、退出码和事实数序列。
- **失败或未验证条件**：任一步计数不符即非零退出。

### TC-012 Codex 缓存子集不重加

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/feasibility.md。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-012`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-009、TC-010、TC-013 共用至少一个测试函数。
- **前置与造数**：与 TC-009/010/013 共用 collector 首个函数；Codex 人工事实为输入 10、缓存子集 4、输出 2。
- **验收断言或人工操作**：Codex total_tokens=12、cache_read_tokens=4；不把缓存再加成 16。
- **脱敏证据**：保存共享 Vitest 函数命令和关键字段断言；无专属函数。
- **失败或未验证条件**：总量不是 12 或缓存子集不是 4 时非零退出。

### TC-013 Claude 四类 Token 合计

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/feasibility.md。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-013`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-009、TC-010、TC-012 共用至少一个测试函数。
- **前置与造数**：与 TC-009/010/012 共用 collector 首个函数；Claude 人工事实含输入 1、输出 4、缓存读 20、缓存写 5。
- **验收断言或人工操作**：Claude total_tokens=30，缓存读=20、缓存写=5；后续 output=6 时总量=32。
- **脱敏证据**：保存共享 Vitest 函数命令和分类/总量断言；无专属函数。
- **失败或未验证条件**：任一分类或总量不符时非零退出。

### TC-014 遥测密钥和监听范围

- **历史状态**：已验证（自动）；tests/telemetry.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-014`。
- **实际绑定**：`tests/telemetry.test.ts` 中 `test('本机遥测只接受密钥，Codex 去重，Claude 累计点计算增量，报表避免双来源相加')`。
- **自动化覆盖**：共享测试；非独立断言；回环地址未单独断言；与 TC-016 共用至少一个测试函数。
- **前置与造数**：与 TC-016 共用 tests/telemetry.test.ts 首个函数；token-test-db-otel-* 内启动随机端口接收器。
- **验收断言或人工操作**：错误 Bearer 返回 401；正确密钥的 /v1/logs 返回 200；配置含可用端点。
- **脱敏证据**：保存共享 Vitest 函数日志与 HTTP 状态；现有测试未单独断言绑定地址为 127.0.0.1。
- **失败或未验证条件**：密钥拒绝或有效请求断言失败即非零；回环监听尚需独立断言才算完整覆盖。

### TC-015 现有配置只读检查

- **历史状态**：已验证（自动）；tests/telemetry.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-015`。
- **实际绑定**：`tests/telemetry.test.ts` 中 `test('遥测配置提示现有用户设置而不修改文件')`。
- **自动化覆盖**：单函数绑定；按源码断言；原配置未字节比对。
- **前置与造数**：tests/telemetry.test.ts 在 token-test-db-settings-* 写入临时 config.toml 与 settings.json。
- **验收断言或人工操作**：inspectConfig 对两种已有配置返回“已发现”，缺失文件返回 null。
- **脱敏证据**：保存该 Vitest 函数日志；当前测试未逐字节断言原配置内容未变化。
- **失败或未验证条件**：冲突提示或缺失文件断言失败即非零；只读不改写仍需更直接的断言。

### TC-016 遥测幂等和重叠优先级

- **历史状态**：已验证（自动）；tests/telemetry.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-016`。
- **实际绑定**：`tests/telemetry.test.ts` 中 `test('本机遥测只接受密钥，Codex 去重，Claude 累计点计算增量，报表避免双来源相加')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-014 共用至少一个测试函数。
- **前置与造数**：与 TC-014 共用 telemetry 首个函数；构造 Codex 重复日志、Claude cumulative 和 delta 批次。
- **验收断言或人工操作**：重复 Codex 后合计 12；Claude 累计 5→8 得 8，重复点不增加；加入本地 Codex 后报表仍 20，delta=7 后为 27。
- **脱敏证据**：保存共享 Vitest 函数命令、退出码和 12/8/20/27 断言。
- **失败或未验证条件**：任一重复、增量或重叠报表断言失败时非零退出。

### TC-017 缺失和不可读来源状态

- **历史状态**：已验证（自动）；tests/collector.test.ts；tests/e2e/source-status.spec.ts；A6。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-017`。
- **实际绑定**：`tests/e2e/source-status.spec.ts` 中 `test('工具目录缺失、无权限和空目录有清晰状态')`；`tests/collector.test.ts` 中 `test('空目录、错误字段及不可读文件显示可辨认的状态')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-018 共用至少一个测试函数。
- **前置与造数**：运行 source-status 端到端及 collector 错误单元函数；各自在 token-test-db-status-* / errors-* 造数。
- **验收断言或人工操作**：缺失 Codex 显示“未找到”，不可读 Claude 显示“需要检查/文件读取失败”；建立空目录后显示“暂无记录”。
- **脱敏证据**：保存同一 TC 命令的 Playwright 与 Vitest 日志和退出码；错误单元函数也被 TC-018 共用。
- **失败或未验证条件**：任一状态文本或错误原因不符、任一绑定测试非零即失败。

### TC-018 无效 Token 字段持续报错

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/validation.md A6。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-018`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('空目录、错误字段及不可读文件显示可辨认的状态')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-017 共用至少一个测试函数。
- **前置与造数**：与 TC-017 共用 collector 错误函数，token-test-db-errors-* 中写入 input_tokens="unknown"。
- **验收断言或人工操作**：扫描后 Codex status=error、factCount=0、detail 含“无法解析”；再次扫描后错误仍显示。
- **脱敏证据**：保存共享 Vitest 函数命令、退出码和错误状态字段。
- **失败或未验证条件**：错误变成正常零用量或后续扫描丢失状态时非零退出。

### TC-019 绑定后权限和报表更新

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A7。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-019`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-002、TC-004、TC-005、TC-010、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002/004/005 等共用 app 端到端函数，token-test-db-app-* 含 Codex 12 和 Claude 14。
- **验收断言或人工操作**：绑定 Codex 给 viewer 后普通用户见 12 Token、gpt-test，Claude 与其模型不可见。
- **脱敏证据**：保存共享 Playwright 函数命令、退出码和 12/14 权限对比。
- **失败或未验证条件**：绑定未生效或普通用户见未授权来源时非零退出。

### TC-020 时区和 ISO 跨年周

- **历史状态**：已验证（自动）；tests/report.test.ts；docs/validation.md A8。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-020`。
- **实际绑定**：`tests/report.test.ts` 中 `test('报表按本地时区与 ISO 周汇总，并限制普通用户归属')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-021、TC-023 共用至少一个测试函数。
- **前置与造数**：与 TC-021/023 共用 tests/report.test.ts；token-test-db-report-* 直接写入两条合计 26 的事实。
- **验收断言或人工操作**：Asia/Shanghai 的 2021-01-01 对应 ISO 2020-W53；日/月/年分别为 2021-01-01、2021-01、2021，总量 26。
- **脱敏证据**：保存共享 Vitest 函数命令、退出码和周期值。
- **失败或未验证条件**：任一时区或周期边界、合计断言失败时非零退出。

### TC-021 筛选与分页明细

- **历史状态**：已验证（自动）；tests/report.test.ts；tests/e2e/app.spec.ts；A8。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-021`。
- **实际绑定**：`tests/report.test.ts` 中 `test('报表按本地时区与 ISO 周汇总，并限制普通用户归属')`；`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；第二页未测试；与 TC-020、TC-023、TC-002、TC-004、TC-005、TC-010、TC-019、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：同一 TC 先跑 report 单元函数，再跑 app 端到端函数；临时报告库和 app 用户目录分别隔离。
- **验收断言或人工操作**：provider=codex 为 12；普通用户仅见绑定 Codex；点击趋势/模型后对应明细可见。
- **脱敏证据**：保存两段共享测试日志；现有自动化没有构造超过 50 条以检查第二页分页。
- **失败或未验证条件**：任一筛选/明细断言失败则命令非零；分页超过首屏仍未被独立覆盖。

### TC-022 CSV 与页面结果一致

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A9。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-022`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；CSV 列结构未测试；与 TC-002、TC-004、TC-005、TC-010、TC-019、TC-021、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002 等共用 app 端到端函数；导出到 token-test-db-app-*/usage.csv。
- **验收断言或人工操作**：CSV 含 gpt-test、claude-test 与 12、14 Token 两行，页面汇总为 26。
- **脱敏证据**：保存共享 Playwright 日志和脱敏 CSV 数值；当前测试没有检查表头 8/9 列错位，见 TC-029。
- **失败或未验证条件**：数值或模型不符时自动非零；表头结构缺陷不能据此判通过。

### TC-023 CSV 公式注入转义

- **历史状态**：已验证（自动）；tests/report.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-023`。
- **实际绑定**：`tests/report.test.ts` 中 `test('报表按本地时区与 ISO 周汇总，并限制普通用户归属')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-020、TC-021 共用至少一个测试函数。
- **前置与造数**：与 TC-020/021 共用 report 单元函数；临时库中模型名设置为 =2+2。
- **验收断言或人工操作**：CSV 出现带前置单引号的模型文本，不出现原样可执行公式文本。
- **脱敏证据**：保存共享 Vitest 函数日志及脱敏 CSV 字段断言。
- **失败或未验证条件**：公式样文本未转义时非零退出。

### TC-024 备份完整性

- **历史状态**：已验证（自动）；tests/backup.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-024`。
- **实际绑定**：`tests/backup.test.ts` 中 `test('数据库备份完整性校验并保留账户与用量')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/backup.test.ts 在 token-test-db-backup-* 建库，写入管理员和 6 Token 事实，生成 backup.sqlite。
- **验收断言或人工操作**：备份通过完整性检查，打开后事实 total_tokens=6；破损 broken.sqlite 被拒绝。
- **脱敏证据**：保存该 Vitest 函数命令、退出码和备份校验断言；不保留数据库文件。
- **失败或未验证条件**：完整备份不可读、事实丢失或破损文件未被拒绝时非零退出。

### TC-025 恢复前副本和状态回退

- **历史状态**：已验证（自动）；tests/e2e/restore.spec.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-025`。
- **实际绑定**：`tests/e2e/restore.spec.ts` 中 `test('管理员备份、恢复后账户回到备份状态')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/e2e/restore.spec.ts 在 token-test-db-restore-* 启动 Electron，备份到 snapshot.sqlite。
- **验收断言或人工操作**：备份后新建 temporary；恢复触发关闭并留下 token.sqlite.before-restore；重启后 temporary 消失，owner 可登录。
- **脱敏证据**：保存 Playwright 日志和脱敏账户状态；不提交 snapshot.sqlite 或数据库副本。
- **失败或未验证条件**：副本缺失、恢复未回退账户或重启登录失败时非零退出。

### TC-026 跨进程权限和数据边界

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A2。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-026`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；磁盘隐私未测试；与 TC-002、TC-004、TC-005、TC-010、TC-019、TC-021、TC-022 共用至少一个测试函数。
- **前置与造数**：与 TC-002 等共用 app 端到端函数；人工 JSONL 仅含用量和模型，无正文。
- **验收断言或人工操作**：viewer 的用户管理、遥测配置、备份 IPC 调用全部 rejected。
- **脱敏证据**：保存共享 Playwright 日志；现有测试未断言磁盘/导出中不存在正文或密钥。
- **失败或未验证条件**：任一越权 IPC 成功时非零；隐私存储边界需另设断言才算完整覆盖。

### TC-027 未签名 DMG 本机验收

- **历史状态**：已验证（人工）；docs/validation.md A10；2026-10-02。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-027`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：本次构建的未签名 DMG、当前 Mac 图形会话与独立用户数据目录；确认包版本和架构。
- **验收断言或人工操作**：先执行 hdiutil verify，再挂载 DMG 并复制 Token.app；从复制的应用启动、登录、扫描并核对脱敏用量。
- **脱敏证据**：DMG 校验输出、包哈希/版本、当前 Mac 信息、复制后应用的脱敏流程记录；历史 A10 不能替代本轮。
- **失败或未验证条件**：DMG 不完整、复制后无法启动或主流程失败时 fail；未安装/未操作保持待验证。
- **人工操作命令**：下列命令构建、校验并复制本机 DMG；Playwright 只对复制出的应用运行现有主流程，仍需人工核对安装与界面。子 shell 在结束或失败时清理临时目录；若挂载在中断时残留，先手工执行 `hdiutil detach "$TOKEN_TC_MOUNT"` 再清理。
```bash
(
set -e
npm run pack:dmg
hdiutil verify Token-0.1.0.dmg
TOKEN_TC_MOUNT=$(mktemp -d /tmp/token-tc027-mount.XXXXXX)
TOKEN_TC_COPY=$(mktemp -d /tmp/token-tc027-copy.XXXXXX)
TOKEN_TC_ATTACHED=0
trap 'if [ "$TOKEN_TC_ATTACHED" = 1 ]; then hdiutil detach "$TOKEN_TC_MOUNT" || true; fi; rm -R "$TOKEN_TC_COPY"; rmdir "$TOKEN_TC_MOUNT"' EXIT
hdiutil attach Token-0.1.0.dmg -nobrowse -mountpoint "$TOKEN_TC_MOUNT"
TOKEN_TC_ATTACHED=1
ditto "$TOKEN_TC_MOUNT/Token.app" "$TOKEN_TC_COPY/Token.app"
hdiutil detach "$TOKEN_TC_MOUNT"
TOKEN_TC_ATTACHED=0
TOKEN_E2E_EXECUTABLE="$TOKEN_TC_COPY/Token.app/Contents/MacOS/Token" ./node_modules/.bin/playwright test tests/e2e/app.spec.ts
)
```
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-027 pass "$PWD/test-results/manual/evidence/TC-027.md"`，失败执行 `npm run test:case -- TC-027 fail "$PWD/test-results/manual/evidence/TC-027.md"`。

### TC-028 签名公证及目标 Mac 验收

- **历史状态**：待验证；尚无签名、公证及其他目标设备证据。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-028`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；待验证。
- **前置与造数**：Apple 开发者证书、签名和公证构建环境，以及另一台目标 Mac；当前仓库没有这项通过证据。
- **验收断言或人工操作**：验证签名、公证票据和 Gatekeeper；在目标 Mac 安装、启动、登录并采集。
- **脱敏证据**：证书身份脱敏信息、签名验证、公证状态、目标 Mac 版本/架构和脱敏流程记录。
- **失败或未验证条件**：缺证书或目标设备时待验证；签名、公证或目标设备主流程失败时 fail。
- **发布环境核验命令**：在具备证书、公证凭据和目标 Mac 的环境，先由发布流程生成已签名公证的 `release/mac/Token.app`；以下命令只核验制品，不能代替签名、公证提交和另一台 Mac 的人工验收。
```bash
codesign --verify --deep --strict --verbose=2 release/mac/Token.app
spctl --assess --type execute --verbose release/mac/Token.app
xcrun stapler validate release/mac/Token.app
```
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-028 pass "$PWD/test-results/manual/evidence/TC-028.md"`，失败执行 `npm run test:case -- TC-028 fail "$PWD/test-results/manual/evidence/TC-028.md"`。

### TC-029 CSV 表头与数据列对齐

- **历史状态**：待验证；src/main/report.ts 当前表头 8 列、数据行 9 列。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-029`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：已知缺陷；禁止通过。
- **前置与造数**：当前 CSV 实现存在已知 8 列表头与 9 列数据；至少导出一条人工构造用量行，使用 CSV 解析器逐列核对。
- **验收断言或人工操作**：修复后的表头与每行均为 9 列，并明确“总 Token”和“用量记录数”两列语义；现状不满足。
- **脱敏证据**：脱敏 CSV 表头/行列数对比与解析结果；修复前仅可记录 fail，不得记录 pass。
- **失败或未验证条件**：runner 对 pass 固定退出码 2；表头仍为 8 列或总 Token 错位时验收失败。
- **人工结果登记**：先建立证据文件；当前缺陷只能执行 `npm run test:case -- TC-029 fail "$PWD/test-results/manual/evidence/TC-029.md"`。运行器拒绝 `pass`。

## M5 计划用例（TC-030–TC-049）

以下均为**待验证**。`npm run test:case -- TC-030` 至 `TC-049` 只是计划中的逐项命令；`scripts/test-cases.mjs` 尚无这些编号，当前执行会失败，不能用清单或历史 A1–A10 记作通过。实施者须使用临时数据库、假时钟、可配置地址的测试服务和人工构造的脱敏记录，新增按编号注册项及实际断言；对 macOS 手工场景需记录包哈希、系统版本、操作和结果。每条证据须含提交、日期、环境、命令、退出码与脱敏结果。

| 用例 | 关联 | 前置与操作 | 通过标准与证据重点 |
| --- | --- | --- | --- |
| TC-030 信任设备恢复登录 | REQ-019 / DEV-020 | 临时账户登录时勾选信任，关闭并重启；对照未勾选登录 | 仅勾选者恢复同一用户；存储无明文密码；保存重启日志和安全存储检查 |
| TC-031 撤销与账户失效 | REQ-020 / DEV-021 | 受信后分别手动退出、停用账户、重置密码再重启；注入损坏凭证 | 无固定过期时间且未退出时可持续登录；上述三种撤销后立即失效并回登录页；保存凭证状态与权限检查 |
| TC-032 服务地址配置与连接 | REQ-021 / DEV-022 | 独立启停服务；验证默认监听/连接地址，显式配置其他监听与 App 连接地址，并测试错误地址 | 默认双方使用 `127.0.0.1`；配置地址匹配时能连接，不匹配时有可恢复错误；停服后本机报表仍可用；保存配置、监听和连接结果，不要求仅回环可连 |
| TC-033 清单与包 | REQ-021 / DEV-022 | 发布人工测试包，请求清单与下载，尝试路径穿越 | 版本、架构、大小、SHA-256 与包一致；任意路径不可读；保存清单和哈希 |
| TC-034 版本与摘要 | REQ-022 / DEV-024 | 模拟新/同/旧版本、架构不匹配和错误 SHA-256 | 只提示匹配的新版本；坏包绝不打开；保存提示与下载校验日志 |
| TC-035 服务/下载故障 | REQ-022 / DEV-024 | 模拟停服、超时、中断、磁盘空间不足后重试 | 错误可见，可重试；无损坏临时包，本机报表仍可用；保存错误和恢复记录 |
| TC-036 未签名安装包交接 | REQ-023 / DEV-025 | 在 macOS 上下载已校验的未签名包，分别打开和取消 | 系统打开安装包但应用不静默替换；取消后旧版及数据可用；保存系统版本、包哈希和人工操作记录 |
| TC-037 三种扫描触发 | REQ-024 / DEV-026 | 假时钟验证启动、10 分钟、手动扫描；注入并发与扫描失败 | 每次完整扫描后恰好一次上传；无并发重复，失败不发完整零快照；保存时间线和请求数 |
| TC-038 聚合隐私 | REQ-025 / DEV-027 | 含正文、路径、密钥样式字符串的合成样本，截获上传体及服务日志 | 只有白名单字段；Token 分类和总量同本机聚合；保存脱敏字段比较 |
| TC-039 幂等和修订 | REQ-026 / DEV-028 | 重发同键快照、发送修订快照并重启客户端 | 服务 upsert 后重复不累加，修订替换旧值；保存键、修订和汇总比较 |
| TC-040 离线补传 | REQ-026 / DEV-028 | 停服完成扫描、观察待传队列，恢复服务 | 有限退避补传；积压、最近失败/成功可见；保存重试时间线和最终汇总 |
| TC-041 单位和原值 | REQ-027 / DEV-029 | 测 1023、1024、1024²、1024³ 边界、未知及大整数 | 只按 K→M→P 逐级 1024 进位，`1024M=1P`，不出现 G/T；精确原值在明细/CSV 保留；保存边界断言 |
| TC-042 概览比较 | REQ-028 / DEV-030 | 两个等长区间的人造记录切换用户、工具、日期 | 总 Token、请求数同明细；基期缺失显示未知；保存页面/查询对账 |
| TC-043 趋势下钻 | REQ-028 / DEV-031 | 按日/周/月切换筛选并点击趋势点 | 趋势与明细求和一致，沿用用户、来源、时区；保存点击前后筛选与值 |
| TC-044 模型排行 | REQ-029 / DEV-031 | 多模型、同值和未知模型样本下切换筛选并点击排行 | 按 Token 降序，同值稳定，明细一致；保存排行与明细对账 |
| TC-045 零和未知 | REQ-029 / DEV-032 | 分别模拟扫描成功无记录、未检测、权限失败 | 只前者显示零；后两者分别显示未覆盖/错误；保存状态和最后成功时间 |
| TC-046 来源状态 | REQ-029 / DEV-032 | 模拟正常、等待、权限不足、格式不支持 | 概览显示状态、覆盖时间和可操作诊断；保存卡片和来源状态对账 |
| TC-047 接口鉴权 | REQ-021 / DEV-023 | 在默认及非回环配置下，以缺失/错误/正确凭证请求清单、包和上报接口，并尝试跨用户覆盖 | 未授权请求不返回受保护制品或写库，合法凭证仅能访问授权范围；非回环连接使用受保护传输；保存响应和数据库计数 |
| TC-048 趋势图窗口缩放 | REQ-030 / DEV-033 | Electron 在窄/宽多个窗口尺寸下显示长日期、大 Token 数值并连续缩放 | 图随容器重排，柱顶数值和横轴日期的边界框不相交、不被裁切；保存截图和布局断言 |
| TC-049 周月日期标签 | REQ-030 / DEV-033 | 构造 ISO 跨年周和跨月样本，切换周/月并点击柱 | 周显示该 ISO 周周一 `YYYY-MM-DD`，月显示 `YYYY-MM`；悬浮和下钻区间一致；保存标签与桶起点断言 |

新增用例全部需要对应单元、集成、Electron 或目标 macOS 断言，以及 `scripts/test-cases.mjs` 注册；规划文档本身不构成通过证据。
