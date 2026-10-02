# Token 仓库协作入口

在本仓库执行开发任务前，先阅读 [docs/agent.md](docs/agent.md)。该文件是 Codex 的项目级工作规则。文档目录及权威来源见 [docs/README.md](docs/README.md)。

功能与 `REQ-###`、`DEV-###`、`TC-###` 的对应关系以 [追溯工作簿](outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx) 为准；编号不复用。

本项目处理本机用量数据。不要提交真实会话 JSONL、数据库、遥测密钥、凭证或含正文的日志。采集器和报表必须保留来源差异、去重规则、权限边界，以及“未知/未覆盖”与零用量的区别。
