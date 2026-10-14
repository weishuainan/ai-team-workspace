# UX Registry 模板与管理规范

> 本文件用于 PHASE 3。
>
> Registry 的目标：
>
> - 每个交互设计 Artifact 一行；
> - 每个 Artifact 有固定 UX ID；
> - Registry 永远指向最新正式产物；
> - 历史版本不在 Registry 中重复保留；
> - 历史版本由文档版本体系或版本控制系统追溯。

# 1. 推荐路径

Registry：

```text
docs/UX_REGISTRY.md
```

单个 UX Artifact：

```text
docs/ux/UX-001/
docs/ux/UX-002/
```

简单需求：

```text
docs/ux/UX-001/design.md
```

复杂需求：

```text
docs/ux/UX-001/design.md
docs/ux/UX-001/prototype.html
```

内部 Review 截图：

```text
docs/ux/UX-001/review-screenshots/
```

如项目已有自己的目录规范，以项目规范为准。

---

# 2. UX ID

格式：

```text
UX-001
UX-002
UX-003
```

规则：

1. UX ID 表示“这是哪一个交互设计 Artifact”；
2. 同一交互方案后续迭代时 UX ID 保持不变；
3. 新的独立交互需求才创建新的 UX ID；
4. UX ID 不等于文档版本。

---

# 3. Document Version

例如：

```text
v1.0
v1.1
v2.0
```

建议语义：

- v1.0：首次正式确认版本；
- v1.1：局部交互、布局、文案调整；
- v2.0：页面结构、核心交互流程或范围发生较大调整。

---

# 4. Registry 标准格式

```markdown
# UX 设计总集

| UX ID | 标题 | 交互内容摘要 | 产物类型 | 主要产物 |
|---|---|---|---|---|
| UX-001 | [标题] | [摘要] | ASCII / Mermaid / HTML | [路径] |
```

---

# 5. 字段说明

## UX ID

固定 Artifact 标识。

## 标题

当前正式交互方案标题。

## 交互内容摘要

建议 2–6 句，说明：

- 设计目标；
- 主要页面 / 区域；
- 核心交互；
- 主要流转关系；
- 如为 HTML，可说明原型覆盖哪些关键交互。

不要把内部 Review 过程写入摘要。

## 产物类型

可填写：

- ASCII；
- Mermaid；
- ASCII + Mermaid；
- HTML。

## 主要产物

简单需求：

```text
docs/ux/UX-001/design.md
```

复杂需求：

优先填写：

```text
docs/ux/UX-001/prototype.html
```

必要时可同时在摘要中说明 `design.md`。

---

# 6. 新建 UX Artifact

1. 获取 Registry 当前最大 UX ID；
2. 分配下一个 ID；
3. 保存正式产物；
4. 在 Registry 追加一行；
5. 文档版本通常从 v1.0 开始。

示例：

```markdown
| UX-004 | Agent 协作工作台交互 | 设计工作台核心协作区，包括 Agent 对话、任务状态、Artifact 查看与 人工审核 入口。采用多区域联动的 HTML 原型展示关键交互。 | HTML | docs/ux/UX-004/prototype.html |
```

---

# 7. 更新已有 UX Artifact

如果用户修改已有交互方案：

1. 不创建新的 UX ID；
2. 更新原目录中的设计产物；
3. 更新文档内部版本；
4. 更新 Registry 对应行；
5. Registry 仍只保留一行。

---

# 8. Registry 不负责

Registry 不负责：

- 保存完整历史版本；
- 保存内部截图；
- 保存每轮 人工审核 记录；
- 保存旧原型链接；
- 记录每次修改 diff。

这些由版本控制系统或 Project / Workspace Artifact 历史负责。

---

# 9. PHASE 3 完成条件

仅当以下条件全部满足，PHASE 3 才完成：

1. 用户已经明确确认 PHASE 2；
2. 正式 `design.md` 已保存；
3. 若为复杂需求，`prototype.html` 已保存；
4. UX ID 已确定；
5. Document Version 已写入；
6. Registry 已新增或更新；
7. Registry 指向当前最新正式产物。
