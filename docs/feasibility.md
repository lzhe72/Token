# M0 本机数据可行性验证

验证日期：2026-10-02。仅检查会话文件结构及用量字段，未把提示词、回复或源码复制到仓库。

## 环境与覆盖

| 工具 | 本机版本 | 可访问的会话文件 | 含用量的文件 | 观察到的格式 |
| --- | --- | ---: | ---: | --- |
| Codex CLI | `0.158.0-alpha.2.1` | 114 | 110 | JSONL `token_usage_record`，另有 `event_msg:token_count` |
| Claude Code | `2.1.126` | 19 | 14 | JSONL `assistant.message.usage` |

文件数只表示此 Mac 在验证时保留的本地记录，不代表服务端总量或产品对所有版本的覆盖率。没有用量的文件可能仅包含未完成会话或元数据。

## 字段结论

### Codex

- 本机共找到 23,849 条 `token_usage_record`，均带 `response_id` 和 `turn_id`。`usage` 包含 `input_tokens`、`cached_input_tokens`、`cache_write_input_tokens`、`output_tokens`、`reasoning_output_tokens` 和 `total_tokens`。
- `event_msg:token_count` 同时提供 `last_token_usage` 与累计的 `total_token_usage`。优先按 `token_usage_record.response_id` 建立一条事实，不再叠加 `token_count`；旧格式没有 `token_usage_record` 时才考虑逐次 `last_token_usage`。
- 模型出现在 `turn_context.model`，应通过 `turn_id` 关联；如发生服务端重路由而本地记录无法确定实际模型，显示“未知模型”或明确标记推定值。
- Codex 的 `cached_input_tokens` 属于输入 Token 的子集，`reasoning_output_tokens` 属于输出 Token 的子集。主总量使用来源提供的 `total_tokens`，不把两个子集重复加总。

### Claude Code

- `assistant.message.usage` 包含 `input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`；同一条记录还可读取 `message.model`、`requestId` 和 `message.id`。
- 同一次请求可能产生多条 `assistant` JSONL 记录。抽样文件中 141 组请求里有 47 组重复，最多重复 7 次，且抽样中的用量值相同。使用请求/消息 ID 幂等归并；若后续记录更新用量，以同一请求最新的完整值覆盖，不能逐行求和。
- 总消耗显示四类 Token 的和，报表同时保留各类明细；该口径与 Codex 的缓存子集口径分开实现。

## 实施决策

1. 第一版先实现只读本地 JSONL 采集，完成真实历史导入与增量监听。
2. 官方遥测作为后续持续采集增强路径；接入前先检测用户已有的 OTel 设置，避免覆盖组织配置。
3. 采集状态明确区分“尚无记录”“格式不支持”“权限不足”“已采集到记录”，不能把前几种状态报为零用量。
4. 不提交真实 JSONL。测试仅使用人工构造、无会话正文的脱敏样本。

## 尚需验证

- Codex 不同客户端入口是否共用所观察的记录格式。
- 旧版 Codex 没有 `token_usage_record` 时 `last_token_usage` 的完整性。
- Claude Code 在请求流式更新、模型切换和子代理场景下的归并规则。
- 两家工具官方遥测与本地记录同时启用时的稳定关联键。
