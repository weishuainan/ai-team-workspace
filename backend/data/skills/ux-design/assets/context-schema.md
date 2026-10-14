# UX Context Schema

> 本文件定义 PHASE 0 中 交互设计 Agent 应从当前对话、Project / Workspace 和可用项目资料中提取的信息结构。
>
> 该 Schema 的目标是判断“现有信息是否足以设计交互”，而不是检查完整工作流是否每个环节都存在。

# 1. Project Context

提取：

- 项目名称；
- 当前需求名称；
- 项目目标；
- 当前需求目标；
- 目标用户 / 使用角色；
- 当前业务场景；
- 已知业务约束；
- 当前 Workflow 阶段；
- 相关 人工审核 决策。

若某项不存在，不强制补齐。

---

# 2. Upstream Artifacts（均为可选）

可能存在：

- 需求澄清；
- 洞察分析；
- MRD；
- 方案设计；
- 已有 PRD；
- 已有页面 / 产品截图；
- 设计规范；
- 历史交互方案；
- 其他与本需求相关的项目资料。

## 规则

1. 所有 Artifact 均为可选；
2. 不要求上游流程齐全；
3. 仅消费当前 Project 中实际存在且与本需求相关的资料；
4. 不因某类 Artifact 缺失默认阻断；
5. 判断标准是“交互目标、范围和主流程是否足够明确”；
6. 若缺失信息不影响核心交互，可正常继续；
7. 若缺失信息会导致核心页面、主流程或交互方式无法确定，则在 PHASE 1 集中暴露。

---

# 3. User-Specified Sources

记录用户明确指定的参考资料。

字段建议：

- source_name
- source_type
- version
- user_priority
- notes

用户明确指定的资料优先级高于普通自动发现资料。

---

# 4. Confirmed Decisions

仅提取已确认内容：

- 已确认目标用户；
- 已确认需求范围；
- 已确认产品方案；
- 已确认页面 / 模块；
- 已确认核心操作；
- 已确认状态；
- 已确认流程分支；
- 已确认角色分工；
- 已确认交互约束；
- 人工审核 结论；
- 已明确排除的非目标。

未确认信息不得作为确定设计前提。

---

# 5. UX Design Goal

用于回答：

> 本次交互设计究竟要帮助用户完成什么？

提取：

- 用户目标；
- 业务目标；
- 本次设计目标；
- 期望用户感知；
- 本次设计不解决什么（如资料已明确）。

---

# 6. User & Scenario Context

提取：

- 用户角色；
- 使用场景；
- 使用时机；
- 使用入口；
- 用户已有认知；
- 主要任务；
- 已确认的前置条件。

---

# 7. Scope Context

按交互承载结构提取：

- 页面；
- 页面区域；
- 功能模块；
- 功能点；
- 主入口；
- 目标去向；
- 涉及角色。

要求：

- 只包含本期已确认范围；
- 不擅自新增页面 / 模块；
- 若上游资料在范围上冲突，记录为 Conflict。

---

# 8. Main Flow Context

提取上游已经确定的用户主操作流程：

- 起点；
- 用户动作；
- 页面 / 系统反馈；
- 下一步；
- 已确认分支；
- 终点。

注意：

> 只记录已确认分支。

不得自动补充：

- 失败；
- 超时；
- 无权限；
- 网络异常；
- 重试；
- 降级；
- 补偿；

除非上游已经明确。

---

# 9. Layout & Information Architecture Context

如已有资料支持，提取：

- 页面层级；
- Header / Sidebar / Main / Panel / Footer 等区域；
- 模块优先级；
- 信息层级；
- 导航关系；
- 列表 / 卡片 / 表格 / 表单等承载形态；
- 已有设计规范；
- 现有产品布局约束。

交互设计 Agent 可以基于已确认需求安排具体布局，但不得改变业务含义。

---

# 10. Interaction Context

提取：

- 点击；
- 输入；
- 选择；
- 切换；
- 展开 / 收起；
- 弹窗；
- Drawer；
- Tab；
- 拖拽；
- 页面跳转；
- 动态生成；
- 进度变化；
- 其他上游明确交互。

对未明确但属于纯交互表达层的细节，交互设计 Agent 可以合理设计。

例如：

- 确定按钮放在弹窗底部；
- 用 Tab 承载并列视图；
- 用 Drawer 承载辅助详情。

前提是：

> 不改变上游产品方案和业务规则。

---

# 11. State Context

只记录上游已经明确的状态。

例如：

- 待执行；
- 执行中；
- 待确认；
- 已完成。

不得为了完整状态机自行补：

- 失败；
- 异常；
- 重试；
- 降级；

除非上游已定义。

记录：

- state_object
- states
- transitions
- user_visible_behavior
- source

---

# 12. Sequence Context

仅当上游已经明确多主体协作时提取：

- 用户；
- Agent；
- 其他 Agent；
- 系统；
- 审批人；
- 其他参与角色。

记录：

- participant
- action
- order
- user_visible_result

不记录底层 API、HTTP code 或技术实现。

---

# 13. Existing Visual / UX References

如存在，记录：

- 当前产品截图；
- 已有页面；
- 设计规范；
- 组件规范；
- 品牌样式；
- 参考产品；
- 用户指定视觉参考。

只作为交互与视觉一致性参考，不改变已确认业务范围。

---

# 14. Complexity Judgment

记录：

- interaction_complexity：simple / complex
- reasoning
- recommended_output

## Simple 判断参考

- 单页面 / 局部模块；
- 单一主流程；
- 静态布局为主；
- 少量点击 / 输入；
- 无复杂联动；
- 无多步骤动态过程。

推荐：

- ASCII Wireframe；
- Mermaid Flowchart。

## Complex 判断参考

满足任一：

- 多页面 / 多视图；
- 多步骤连续流程；
- 多区域联动；
- 动态内容逐步生成；
- 复杂状态变化；
- 多角色 / 多 Agent 协作；
- 需要点击体验才能有效评审；
- 用户明确要求 HTML。

推荐：

- HTML Interactive Prototype。

---

# 15. Diagram Decision

记录：

- ascii_required：yes / no
- flowchart_required：yes / no
- state_diagram_required：yes / no
- sequence_diagram_required：yes / no
- html_required：yes / no

规则：

- 简单需求至少选择 ASCII 或 Flowchart 之一；
- 复杂需求必须 HTML；
- State Diagram 非必要不展示；
- Sequence Diagram 非必要不展示。

---

# 16. Open Issues

仅记录会影响交互设计的真实问题：

- Missing Information；
- Conflicts；
- Pending Decisions；
- Scope Unclear；
- Core Flow Unclear；
- State Unclear；
- Visual Constraint Unclear。

每条至少记录：

- issue_id；
- affected_area；
- description；
- recommendation；
- source_conflict（如有）；
- status。

不要把上游未要求的异常 / 失败处理主动创建为 Open Issue。

---

# 17. Source Mapping

对关键交互结论记录来源：

| 交互结论 | 来源 Artifact / 对话 | 版本 | 是否已确认 |
|---|---|---|---|

重点记录：

- 目标用户；
- 需求范围；
- 主流程；
- 核心页面；
- 核心状态；
- 核心交互；
- 关键视觉约束。

---

# 18. Completeness Judgment

PHASE 0 结束时判断是否足以进入 PHASE 1。

一般应至少能够确认：

- 用户是谁；
- 用户要完成什么；
- 本次设计范围；
- 主流程大致是什么；
- 至少能识别主要页面 / 模块；
- 是否为简单 / 复杂需求。

可以存在待确认项，只要这些问题可以在 PHASE 1 集中解决。

典型不足：

- 完全无法判断设计目标；
- 完全无法判断范围；
- 上游方案在核心流程上互相冲突；
- 复杂交互的核心页面 / 主流程尚未定义。

这类情况应先请求必要补充。
