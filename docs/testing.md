# 测试执行与数据隔离

`TC-001` 至 `TC-029` 的编号以[追溯工作簿](../outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)为准。每个编号在 `scripts/test-cases.mjs` 中有一个入口，可用同一脚本重复执行。多个 TC 可以共享一个覆盖较广的测试，但每个 TC 都必须明确指向具体测试名称。新增用例时，同步增加注册项和断言。

M5 另规划 `TC-030` 至 `TC-049`，目前只有[逐项验收条件](test-case-acceptance.md#m5-计划用例tc-030tc-049)和工作簿编号，**尚未注册到运行器，也没有测试通过结果**。开发时须补测试与注册项后才能执行相应编号；现有 `test:cases:check` 只校验已注册的 TC-001–029。

## 命令

| 目的 | 命令 |
| --- | --- |
| 查看所有用例入口 | `npm run test:case -- --list` |
| 运行一个自动用例 | `npm run test:case -- TC-020` |
| 核对编号和测试绑定 | `npm run test:cases:check` |
| 运行交付门禁 | `npm run test:gate` |
| 运行打包应用端到端测试 | `npm run test:e2e:packaged` |

`test:gate` 依次运行类型检查、用例注册检查、全部 Vitest 测试和构建后的 Electron Playwright 测试。自动用例失败则命令返回非零。涉及打包行为的变更还需运行打包应用端到端测试，并保留实际命令与结果。

人工用例也使用 `npm run test:case -- TC-001` 这样的命令读取操作清单。完成后用 `npm run test:case -- TC-001 pass /绝对路径/脱敏证据文件` 记录结果；失败时改用 `fail`。缺少证据、尚未操作时命令返回非零。记录写入被 Git 忽略的 `test-results/manual/`，不能把真实会话正文、凭证或用户数据库提交到仓库。`TC-029` 是已登记的 CSV 表头缺陷，修复并改成自动断言前脚本不允许标记通过。`TC-028` 的签名、公证及另一台 Mac 验收仍需真实发布环境。

## 测试数据库

所有单元测试通过 `tests/support/test-workspace.ts` 在系统临时目录创建各自独立的 `token.sqlite`。Electron 端到端测试也使用该辅助函数的临时目录作为 `--token-user-data`，Codex/Claude 人工构造样本目录均在其中。每次测试结束清理目录；测试不得指向真实用户数据目录，也不得以真实会话正文造数。

## 每次功能交付

1. 依据变更范围在追溯工作簿中维护 REQ、DEV、TC 关联，并修改或新增相应测试及 `scripts/test-cases.mjs` 注册项。
2. 用 `npm run test:case -- TC-XXX` 单独运行受影响用例，再运行 `npm run test:gate`。适用的人工或打包验收也须执行。
3. 在交付说明中记录用例编号、命令、结果、环境和未通过项。相关用例未通过时，不把功能标记为交付完成。
