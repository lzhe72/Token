# Token 测试用例逐项验收

本文逐条说明追溯工作簿中的 TC-001 至 TC-072 的目标、实际绑定和证据边界。TC-050 至 TC-071 已有 M6 自动入口和逐编号结果；TC-072 仅有人工作业清单，尚无目标 Mac 通过证据。已注册用例的命令均从仓库根目录执行，先用 `npm ci` 安装锁定依赖。用例注册以 `scripts/test-cases.mjs` 为准，执行入口为 `scripts/run-test-case.mjs`。工作簿 H/I 列保留对应版本的验收状态和证据，不代表后续版本已经复验。

## 执行与证据边界

- 共 72 条：TC-001–049 中 44 条有自动入口、5 条为人工入口；M6 的 TC-050–071 另有 22 条自动入口、TC-072 为人工入口。多条旧编号可能运行同一测试函数；M6 每个自动编号绑定自己以 `TC-###` 开头的测试函数。TC-030、TC-038 还各自绑定额外端到端测试。
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
- TC-029 已绑定 CSV 列结构单元断言；旧版关于“禁止通过”的说明仅对应修复前提交。历史 A1–A10 或代码中的断言不能代替当前版本、当前环境的逐项结果。

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
- **自动化覆盖**：人工入口；0.3.0 本次以复制版主流程 Playwright 1/1 通过及独立界面核对辅助人工验收，范围见下方本次结果。
- **前置与造数**：本次构建的未签名 DMG、当前 Mac 图形会话与独立用户数据目录；确认包版本和架构。
- **验收断言或人工操作**：先执行 hdiutil verify，再挂载 DMG 并复制 Token.app；从复制的应用启动、登录、扫描并核对脱敏用量。
- **脱敏证据**：DMG 校验输出、包哈希/版本、当前 Mac 信息、复制后应用的脱敏流程记录；历史 A10 不能替代本轮。
- **失败或未验证条件**：DMG 不完整、复制后无法启动或主流程失败时 fail；未安装/未操作保持待验证。
- **人工操作命令**：下列命令构建、校验并复制本机 DMG；Playwright 只对复制出的应用运行现有主流程，仍需人工核对安装与界面。子 shell 在结束或失败时清理临时目录；若挂载在中断时残留，先手工执行 `hdiutil detach "$TOKEN_TC_MOUNT"` 再清理。
```bash
(
set -e
npm run pack:dmg
TOKEN_TC_DMG="Token-$(node -p 'require("./package.json").version').dmg"
hdiutil verify "$TOKEN_TC_DMG"
TOKEN_TC_MOUNT=$(mktemp -d /tmp/token-tc027-mount.XXXXXX)
TOKEN_TC_COPY=$(mktemp -d /tmp/token-tc027-copy.XXXXXX)
TOKEN_TC_ATTACHED=0
trap 'if [ "$TOKEN_TC_ATTACHED" = 1 ]; then hdiutil detach "$TOKEN_TC_MOUNT" || true; fi; rm -R "$TOKEN_TC_COPY"; rmdir "$TOKEN_TC_MOUNT"' EXIT
hdiutil attach "$TOKEN_TC_DMG" -nobrowse -mountpoint "$TOKEN_TC_MOUNT"
TOKEN_TC_ATTACHED=1
ditto "$TOKEN_TC_MOUNT/Token.app" "$TOKEN_TC_COPY/Token.app"
hdiutil detach "$TOKEN_TC_MOUNT"
TOKEN_TC_ATTACHED=0
TOKEN_E2E_EXECUTABLE="$TOKEN_TC_COPY/Token.app/Contents/MacOS/Token" ./node_modules/.bin/playwright test tests/e2e/app.spec.ts
)
```
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-027 pass "$PWD/test-results/manual/evidence/TC-027.md"`，失败执行 `npm run test:case -- TC-027 fail "$PWD/test-results/manual/evidence/TC-027.md"`。
- **0.3.0 本次结果（2026-10-02）**：本机人工登记 `pass`，记录为 `test-results/manual/TC-027.json`，操作证据为 `test-results/manual/evidence/TC-027.md`，界面截图为同目录 `TC-027-report.png`；代码 `6223c30`，macOS 15.7.4 x86_64。`Token-0.3.0.dmg` SHA-256 为 `64917685d073d0c631ef492df58eb3a3bec96657f15372177af466c68a34fec8`，`hdiutil verify` VALID，挂载、`ditto` 复制、卸载成功；复制版主流程 1/1 通过，第二次独立复制及合成数据界面核对通过。完整脱敏摘要见[本次验收记录](validation.md#tc-027-v030-本机未签名-dmg-人工验收2026-10-02)。本机证据文件被 Git 忽略；历史 A10 保留。Finder 拖拽安装、真实更新替换、签名公证和另一台 Mac 未验证。

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

- **历史状态**：修复前版本表头 8 列、数据行 9 列；该历史缺陷不代表当前实现。本轮结果以固定提交的命令和证据为准。
- **执行命令**：`npm run test:case -- TC-029`。
- **实际绑定**：`tests/next-report.test.ts` 中 `test('TC-029 CSV 表头和数据列对齐')`，由 Vitest 按名称运行。
- **自动化覆盖**：人工构造一行用量，检查 CSV 表头及数据行为 9 列，`总 Token` 列名与数值 `12` 对齐，末列记录数为 `1`。测试以逗号拆分固定造数，不覆盖所有引号、换行与公式转义组合；CSV 公式注入另见 TC-023。
- **前置与造数**：`tests/support/test-workspace.ts` 创建独立临时库，插入 12 Token 的 `gpt-test` 记录。
- **脱敏证据**：保存该编号命令、退出码、测试日志、代码提交和环境；无需人工 `pass` 登记。
- **失败或未验证条件**：列数、列名或列值不符时 Vitest 非零退出；未运行固定提交时不把“有测试代码”当作已验证。
- **本轮结果**：提交 `96e99be` 的 `npm run test:acceptance -- 29 49` 中该编号退出码 0；本机日志在被 Git 忽略的 `test-results/acceptance/TC-029.log`。

## M5 用例绑定与覆盖（TC-030–TC-049）

`TC-030` 至 `TC-049` 已在 `scripts/test-cases.mjs` 注册。执行单条用例用 `npm run test:case -- TC-###`；除标明额外端到端绑定的编号外，入口运行下表对应的一个 Vitest 或 Playwright 函数。下表描述**当前断言实际覆盖**，与上面的验收目标仍有差距的地方写在“限制”列。证据须含固定代码提交、日期、环境、命令、退出码与脱敏结果。未执行或缺目标环境时，不因入口存在而写成通过。

本轮固定提交 `96e99be` 执行 `npm run test:acceptance -- 29 49`，`summary.json` 记录 TC-029–049 **21/21 退出码 0**；逐编号日志位于本机 `test-results/acceptance/`（Git 忽略）。这证明下表列出的自动断言通过，未覆盖的人工和环境边界仍保持待验证。

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

### 实际绑定与剩余验证

下表文件中以 `TC-###` 开头的 `test(...)` 函数就是该编号的实际绑定。每条命令可单独运行；TC-030、TC-038 的命令会先运行单元测试，再运行额外的 Electron 测试。表内 TC-036 一行保留 `96e99be` 自动测试的历史断言；`44a96e8` 新增的本机隔离更新链路结果见表后补充记录。`TC-028` 的签名、公证和另一台 Mac 验收依旧独立待办。

| 编号 | 实际绑定文件 | 当前断言与限制 |
| --- | --- | --- |
| TC-030 | `tests/next-auth.test.ts`；`tests/e2e/trust.spec.ts` | 单元验证凭证跨数据库重开与未勾选存储为空；Electron 验证勾选后重启自动登录及退出后回登录页。未覆盖另一 macOS 账户。 |
| TC-031 | `tests/next-auth.test.ts` | 单元验证无固定到期、退出撤销、重置密码/停用失效及损坏凭证；管理员界面操作路径未单独验收。 |
| TC-032 | `tests/next-server.test.ts` | 验证默认回环、`localhost` 配置、无 TLS 的 `0.0.0.0` 被拒；临时自签证书下实际绑定 `0.0.0.0` 并经 HTTPS 健康检查成功。测试客户端关闭证书校验，尚未验证可信证书、异机连接和地址不匹配。 |
| TC-033 | `tests/next-server.test.ts` | 合成包的清单、大小、SHA-256 与路径穿越拒绝；未用真实发布 DMG 验证。 |
| TC-034 | `tests/next-update.test.ts` | 同版、旧版、架构不符、坏摘要与较新版提示；版本差异及下载由合成包验证。 |
| TC-035 | `tests/next-update.test.ts` | 停服后下载失败、清理临时文件和重启服务重试；未单独注入超时、磁盘不足。 |
| TC-036 | `tests/next-update.test.ts` | 校验后调用注入的打开回调且旧文件不变；未在真实 macOS 打开 DMG、取消安装或验证安装失败回退。 |
| TC-037 | `tests/next-sync.test.ts` | 假时钟检查启动、10 分钟及手动调用扫描；扫描函数被 mock，未单独断言并发串行、失败扫描不上传。上传主流程另见 TC-038。 |
| TC-038 | `tests/next-sync.test.ts`；`tests/e2e/upload.spec.ts` | 单元检查聚合入库无会话/路径标识，Electron 验证手动扫描后服务器入库及上报成功；敏感字段白名单另见 TC-047。 |
| TC-039 | `tests/next-sync.test.ts` | 同快照重复发送不增行、修订后总量替换；未在多设备并发下验证。 |
| TC-040 | `tests/next-sync.test.ts` | 停服积压、数据库重开和恢复补传；退避时间通过手动调整元数据推进，未长时间运行验证。 |
| TC-041 | `tests/next-report.test.ts` | 检查 1023、K/M/P 边界及 CSV 原值；未覆盖超过 JavaScript 安全整数的精确表示。 |
| TC-042 | `tests/next-report.test.ts` | 检查等长区间数值和比较文案；未用 Electron 验证所有界面筛选联动。 |
| TC-043 | `tests/next-report.test.ts` | 日/周/月点与明细求和，周/月界面点击另见 TC-049；未覆盖全部时区。 |
| TC-044 | `tests/next-report.test.ts` | 按总量降序、同值稳定和模型明细；未知模型及界面点击未单独断言。 |
| TC-045 | `tests/next-report.test.ts` | `no_records`、错误状态与比较文案分离；未单独验证所有缺失/权限状态在界面的呈现。 |
| TC-046 | `tests/next-report.test.ts` | 来源事实数、最近扫描时间、未找到目录文案；未覆盖格式不支持等全部状态卡片。 |
| TC-047 | `tests/next-server.test.ts` | 错误凭证、非法字段、Origin 拒绝、HTTPS 配置限制；本用例尚未在非回环 HTTPS 连接上执行鉴权，也未验证跨用户授权。 |
| TC-048 | `tests/e2e/trend.spec.ts` | 在 1180、860 两种窗口宽度截屏并断言数值/日期边界框不重叠；未覆盖更窄窗口、所有本地化字体及裁切边界。 |
| TC-049 | `tests/e2e/trend.spec.ts` | ISO 跨年周周一标签、月标签及点击明细行数；其他时区和长期跨度需另验。 |

上述限制是后续补测清单，不把未覆盖部分写成已通过。`TC-027` 的本机安装验收和 `TC-028` 的外部分发验收仍按各自人工证据独立判定。

**TC-036 新增本机链路记录（2026-10-02，代码 `44a96e8`）**：`npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.2.0.dmg /Users/lz/文档/Token/Token-0.3.0.dmg` 使用 `scripts/verify-local-upgrade.mjs`，在本机隔离目录复制旧版应用、启动并勾选信任设备；旧版连接临时本机更新服务，发现 0.3.0、下载并打开安装包；下载 SHA-256 与发布包一致。脚本关闭旧版后以 `ditto` 在同一临时安装路径替换为新版，沿用同一临时用户数据目录启动，新版受信登录与合成报表 1280 Token 均通过。日志在开发工作树 `test-results/manual/evidence/TC-036-upgrade.log`（Git 忽略），脱敏摘要见[验收记录](validation.md)。此结果标记为**部分验证：本机隔离更新交接与替换通过**；取消安装、安装失败回退、Finder 人工拖拽至 `/Applications`、生产数据迁移、签名公证及目标 Mac 仍待验证。脚本是独立复验入口，`npm run test:case -- TC-036` 仍只运行表内单元断言。

## M6 目标与实际覆盖（TC-050–TC-072）

下表保留原定目标，实际覆盖以其后的绑定表为准。`scripts/test-cases.mjs` 已注册 TC-050–072，每条命令为 `npm run test:case -- TC-###`。自动用例通过 `tests/support/test-workspace.ts` 为每个编号创建独立的 `token-test-db-tc###-*` 临时目录及 `token.sqlite`；Electron 的 `--token-user-data` 指向该目录，服务端使用目录内文件和随机端口，结束清理。**每个编号有自己的数据库，即使测试文件共用，也不共享状态**。TC-072 用独立测试用户数据目录和真实目标 Mac 操作，尚未取得人工证据。所有反馈/诊断样本均为人工合成数据。

| 用例／关联 | 目标前置与操作 | 目标与证据重点 | 实际测试文件 |
| --- | --- | --- | --- |
| TC-050／REQ-031 DEV-034 | 专用库中放有 cwd 与缺 cwd 的 Codex 合成会话并扫描 | 正确项目归属，缺 cwd 为未知；不读取目录内容 | `tests/m6-project.test.ts` |
| TC-051／REQ-031 DEV-034 | 专用库中放有 cwd、缺 cwd 与子代理的 Claude 合成会话 | 同会话归属一致，子代理不误归其他项目 | `tests/m6-project.test.ts` |
| TC-052／REQ-031 DEV-035 | 两个绝对路径同名项目，截取聚合、反馈、诊断外发 | 项目区分；外发无完整路径、项目 ID/别名；旧事实保持未知 | `tests/m6-project.test.ts` |
| TC-053／REQ-032 DEV-036 | 多用户、项目、模型、时区及未知项目事实 | 授权聚合与事实求和一致；无越权；未知单列 | `tests/m6-report.test.ts` |
| TC-054／REQ-032 DEV-037 | Electron 在专用用户数据中切换项目、模型、趋势和下钻 | 筛选继承且排行/明细相符，无跨项目串数 | `tests/e2e/m6-analysis.spec.ts` |
| TC-055／REQ-032 DEV-036 | 同一筛选导出 CSV，含未知项目和跨年周 | 页面/CSV 分类及总量一致，防公式注入且无路径 | `tests/m6-report.test.ts` |
| TC-056／REQ-033 DEV-038 | Electron 打开长报表，只滚动右侧内容 | 侧栏不移动，焦点及操作可见 | `tests/e2e/m6-shell.spec.ts` |
| TC-057／REQ-033 DEV-038 | 宽窄窗口切换页面和下钻路径 | 无遮挡/不可达控件；面包屑与状态一致且可回退 | `tests/e2e/m6-shell.spec.ts` |
| TC-058／REQ-034 DEV-039 | 登录后不滚动概览查找更新入口 | 在明显导航/设置位置可发现 | `tests/e2e/m6-update.spec.ts` |
| TC-059／REQ-034 DEV-039 | 模拟同版、新版、中断、摘要错误与重试 | 状态准确；坏包不打开；旧版可用 | `tests/e2e/m6-update.spec.ts` |
| TC-060／REQ-035 DEV-040 | 用超管、管理员、查看者进入集中设置并调用 IPC | 分组完整；无权修改在主进程拒绝 | `tests/e2e/m6-settings.spec.ts` |
| TC-061／REQ-035 DEV-040 | 合成无权限目录，再恢复可读 | 指向具体来源与手动授权/重试；不自动提权 | `tests/e2e/m6-settings.spec.ts` |
| TC-062／REQ-036 DEV-041 | 构造目录缺失、解析错、游标停滞、未归属和重复 | 指出漏采环节与最后成功；未知不当零 | `tests/m6-diagnostics.test.ts` |
| TC-063／REQ-036 DEV-041 | 合成路径、正文和密钥样式字段，按角色索取摘要 | 外发/日志脱敏；普通用户仅看授权来源 | `tests/m6-diagnostics.test.ts` |
| TC-064／REQ-037 DEV-042 | 反馈预览后显式提交，输入含敏感样式 | 仅白名单上传；未经确认不上传；敏感字段不外传 | `tests/m6-feedback.test.ts` |
| TC-065／REQ-037 DEV-043 | 临时服务随机端口，测试无凭证、停服及重复提交 | 未授权拒绝；恢复后幂等入库且状态可见 | `tests/m6-feedback.test.ts` |
| TC-066／REQ-038 DEV-044 | 多用户反馈以三类角色进入管理界面/IPC | 管理员按授权查看；查看者无管理读取 | `tests/e2e/m6-admin.spec.ts` |
| TC-067／REQ-038 DEV-044 | 专用库有启停账号及正常/异常来源 | 账号角色、启停、来源状态准确且不越权 | `tests/e2e/m6-admin.spec.ts` |
| TC-068／REQ-039 DEV-045 | 空库初始化并重新初始化 | 首建固定 `admin`，库角色 `admin`、对外 `superadmin`；重复拒绝 | `tests/m6-roles.test.ts` |
| TC-069／REQ-039 DEV-046 | 固定账号、普通管理员、查看者分别操作账号 | 仅固定账号派生超管；其他管理员保留旧创建权限但不能停用/重置固定账号 | `tests/m6-roles.test.ts` |
| TC-070／REQ-039 DEV-045 | 复制合成旧库：已有 admin 管理员、无 admin、admin 为 viewer、迁移失败 | 正确兼容；冲突不静默升权；ID/哈希/归属不变；失败可回退 | `tests/m6-roles.test.ts` |
| TC-071／REQ-039 DEV-046 | 固定账号创建管理员/查看者，其他角色试超管操作 | 角色和管理边界正确；如提供审计查看则仅超管可见 | `tests/e2e/m6-admin.spec.ts` |
| TC-072／REQ-035 DEV-040 | 目标 Mac 的独立测试账户先拒绝再手动授予文件访问权限 | 指引可执行、重试后恢复；无权限时未知且不越权 | 人工清单，需目标 Mac 脱敏证据 |

实际绑定以 `scripts/test-cases.mjs` 为准。最终提交 `6223c30` 的 `test-results/acceptance/summary.json` 记录 2026-10-02 14:56–14:57 UTC、`darwin-x64`、Node v24.15.0、TC-050–071 **22/22 退出码 0**；逐编号日志位于开发工作树被 Git 忽略的 `test-results/acceptance/`。该结果仅证明以下实际断言通过，目标表中超出断言的内容仍待补证。TC-072 的 `npm run test:case -- TC-072` 只显示人工清单，不能自动判通过；只有目标 Mac 脱敏证据及人工 `pass` 登记才算完成。

| 用例 | 实际绑定测试函数 | 当前断言与剩余边界 |
| --- | --- | --- |
| TC-050 | `tests/m6-project.test.ts`：`TC-050 Codex cwd 归属与缺失项目保持未知` | 合成 Codex 会话的 cwd 哈希归属、缺失为未知；未覆盖真实版本格式变化。 |
| TC-051 | `tests/m6-project.test.ts`：`TC-051 Claude cwd 和子代理文件独立归属` | 合成主会话、子代理各归项目，缺 cwd 未知；未覆盖所有真实子代理格式。 |
| TC-052 | `tests/m6-project.test.ts`：`TC-052 同名路径不合并且外发摘要无项目标识` | 同名不同路径键/标签分开，诊断摘要无路径/键，历史无 cwd 保持未知；其他外发通道另见 TC-064。 |
| TC-053 | `tests/m6-report.test.ts`：`TC-053 项目模型聚合沿用授权范围和未知项目` | 合成 25 Token、多用户权限、项目/模型与未知分组；只用 UTC 示例，更多时区待测。 |
| TC-054 | `tests/e2e/m6-analysis.spec.ts`：`TC-054 项目模型筛选及趋势下钻保持同一用量范围` | Electron 对账 42→12 Token、项目/模型筛选和一次日下钻；其他时间粒度组合待测。 |
| TC-055 | `tests/m6-report.test.ts`：`TC-055 项目筛选 CSV 与页面同口径且文本安全` | 单个项目跨年周 CSV、明细 10 Token 与公式文本转义；更大数据量及全部字段组合待测。 |
| TC-056 | `tests/e2e/m6-shell.spec.ts`：`TC-056 长报表右侧滚动时左侧导航保持固定` | 长页右侧滚动时侧栏位置不变；键盘焦点与更多窗口尺寸待测。 |
| TC-057 | `tests/e2e/m6-shell.spec.ts`：`TC-057 窄窗口路径可见且下钻可从面包屑返回` | 760×700 窗口、面包屑回退和无横向溢出；更窄窗口及辅助功能待测。 |
| TC-058 | `tests/e2e/m6-update.spec.ts`：`TC-058 登录后可直接发现检查更新入口` | 登录后设置中可找到更新入口；未验证真实用户发现率。 |
| TC-059 | `tests/e2e/m6-update.spec.ts`：`TC-059 新版坏包提示错误且重试后可重新检查` | 合成新版坏摘要被拒、重查旧版显示最新；未验证真实 DMG 打开/安装与网络中断。 |
| TC-060 | `tests/e2e/m6-settings.spec.ts`：`TC-060 设置分组完整且普通用户修改接口被拒绝` | 设置分组可见、viewer 修改 IPC 被拒；普通管理员的所有设置权限组合待测。 |
| TC-061 | `tests/e2e/m6-settings.spec.ts`：`TC-061 缺少目录时诊断引导权限设置和重新扫描` | 缺目录时显示权限指引和重扫入口；真实 macOS 授权/撤销留给 TC-072。 |
| TC-062 | `tests/m6-diagnostics.test.ts`：`TC-062 缺目录解析错待写完记录及未归属有独立诊断` | 缺目录、错误记录、待写尾行、未归属和最后成功状态；长时间游标停滞待测。 |
| TC-063 | `tests/m6-diagnostics.test.ts`：`TC-063 诊断摘要不包含原始路径正文与项目标识` | 合成路径与项目键不进入诊断摘要；所有日志/外发渠道的系统级审计待补。 |
| TC-064 | `tests/m6-feedback.test.ts`：`TC-064 反馈仅显式提交且阻止路径密钥进入服务` | 未提交前服务为空、路径/密钥样式被拒；预生成编号与服务入库编号一致，界面预览另见 TC-066。 |
| TC-065 | `tests/m6-feedback.test.ts`：`TC-065 反馈离线持久化重试幂等且管理读取需独立密钥` | 离线排队、恢复后一次入库、重复 POST 幂等及管理密钥；长期退避与跨设备冲突待测。 |
| TC-066 | `tests/e2e/m6-admin.spec.ts`：`TC-066 管理员可看反馈列表而普通用户接口拒绝` | 超管预览显示实际用户名及预生成编号，提交成功提示编号一致；反馈列表可见，viewer 管理入口和 IPC 被拒；普通管理员反馈视图待单测。 |
| TC-067 | `tests/e2e/m6-admin.spec.ts`：`TC-067 账号启停归属和采集状态随操作更新` | 一名 viewer 的来源绑定、采集状态及停启变化；多来源异常状态待测。 |
| TC-068 | `tests/m6-roles.test.ts`：`TC-068 首建固定 admin 且库内角色兼容旧约束` | 非固定首建拒绝、库角色 admin/对外 superadmin、重复首建拒绝。 |
| TC-069 | `tests/m6-roles.test.ts`：`TC-069 普通管理员保留建户权限但不能改动固定 admin` | 普通管理员可建 admin/viewer，不能停用或重置固定账号；其他管理 IPC 待单测。 |
| TC-070 | `tests/m6-roles.test.ts`：`TC-070 旧库 admin 冲突显式处理且保留账号 ID 和哈希` | 旧库 viewer 占用 admin 时显式改名，失败改名不改变原账户；已有 admin 自动派生超管，无 admin 时原管理员可创建固定账号，ID/哈希保留。真实生产库迁移回滚未演练。 |
| TC-071 | `tests/e2e/m6-admin.spec.ts`：`TC-071 固定 admin 创建管理员与普通用户且角色边界生效` | 超管界面创建两类账号；普通管理员不能停用/重置固定账号；完整审计功能未纳入本轮。 |
| TC-072 | `scripts/test-cases.mjs` 人工清单 | **待验证**：目标 Mac 拒绝、授予、撤销文件访问权限后的状态与重扫均无人工证据。 |
