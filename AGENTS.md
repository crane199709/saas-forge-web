# AGENTS.md

## 代码注释

- 注释使用中文；专有名词、协议名、框架名、API、代码标识符和关键字保留英文。
- 新增或修改注释时，在正文前添加时间戳，使用北京时间（Asia/Shanghai），格式为 `yyyyMMddHHmm：说明`，例如 `// 202610162155：xxx`；注释符号按文件语言选择。
- 对局部代码、类型和名称无法可靠表达的原因或约束补充注释：对外契约与字段语义、业务规则依据、历史兼容、第三方约定、不可交换的副作用顺序、非默认边界处理，以及性能、安全、稳定性或临时技术取舍。
- 以命名、类型和清晰结构表达可直接看出的行为；简单访问器、DTO、直白流程和无转换规则的字段拷贝无需说明性注释。
- 修改代码时检查相邻注释，更新或删除已经失效的内容；移除注释掉的代码、修改历史及无行动内容的说明。

## Agent skills

### Issue tracker

使用 crane199709/saas-forge-web 的 GitHub Issues。
详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认 triage 标签。
详见 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context：根目录 `CONTEXT.md` 和 `docs/adr/`。
详见 `docs/agents/domain.md`。
