# 材料总结 — 输入输出 Schema

## 输入 Schema

```python
class MaterialSummaryInput(BaseModel):
    """Skill 02 材料总结的输入"""
    project_name: str                    # 项目名称
    project_problem: str                 # 一句话描述问题
    project_goal: str                    # 项目目标
    project_background: str              # 补充背景（可能为空）

    # 已确认的需求澄清结果（若已执行）
    approved_clarification: Optional[dict] = None  # 包含目标用户、使用场景等

    # 协作消息列表
    messages: list[MessageItem]          # 项目内所有消息

    # 当前指令
    instruction: str                     # 用户本次 @Agent 的具体指令

class MessageItem(BaseModel):
    sender_type: str          # HUMAN / AGENT / SYSTEM
    sender_name: str          # 发送者名称
    content: str              # 消息内容
    created_at: str           # 时间戳
    message_type: str         # TEXT / AGENT_RESULT / SYSTEM_EVENT
```

### 输入校验规则

1. `messages` 列表不能为空。若为空，返回 `NEED_HUMAN`，提示"项目中暂无讨论材料，请先补充用户反馈或业务背景后再进行总结"。
2. `project_name` 和 `project_problem` 不能为空。若为空，返回 `NEED_HUMAN`，提示"项目基本信息缺失，请先完善项目描述"。
3. 若 `messages` 总文本量不足 100 字，仍可执行，但在输出的 `open_questions` 中标注"当前材料量较少，总结可能不完整，建议补充更多材料"。

---

## 输出 Schema

```python
class MaterialSummaryOutput(BaseModel):
    """Skill 02 材料总结的结构化输出"""

    # 元信息
    summary_scope: str                    # 本次总结覆盖的材料范围描述
    source_count: int                     # 涉及的原始材料条目数
    material_types: list[str]             # 材料类型标注

    # 核心输出五大模块
    core_facts: list[FactItem]            # 核心事实
    key_viewpoints: list[ViewpointItem]   # 重要观点
    user_problems: list[ProblemItem]      # 用户问题
    conflicts: list[ConflictItem]         # 冲突点
    open_questions: list[str]             # 待确认问题

    # 质量元数据
    coverage_assessment: str              # 材料覆盖度自评（充分 / 一般 / 不足）
    confidence_level: str                 # 整体置信度（高 / 中 / 低）


class FactItem(BaseModel):
    """核心事实 — 有明确来源、可验证的客观信息"""
    fact: str                              # 事实描述
    source: str                            # 来源标注
    source_type: str                       # user_feedback / merchant_feedback / discussion / business_data / background / historical_doc
    confidence: str                        # high / medium / low


class ViewpointItem(BaseModel):
    """重要观点 — 团队成员的主观判断、推测或建议"""
    viewpoint: str                         # 观点内容
    holder: str                            # 观点持有人
    reasoning: str                         # 提出该观点的依据或理由
    is_consensus: bool                     # 是否已被团队达成共识


class ProblemItem(BaseModel):
    """用户问题 — 从材料中提取的用户侧问题"""
    problem_description: str               # 问题描述
    user_segment: str                      # 涉及的用户群体
    severity: str                          # high / medium / low / unknown
    frequency_mention: str                 # frequent / occasional / single
    source: str                            # 来源标注


class ConflictItem(BaseModel):
    """冲突点 — 材料中相互矛盾或存在分歧的信息"""
    conflict_description: str              # 冲突描述
    position_a: str                        # 观点 A
    position_a_source: str                 # 观点 A 来源
    position_b: str                        # 观点 B
    position_b_source: str                 # 观点 B 来源
    resolution_status: str                 # unresolved / needs_verification
```

---

## Artifact 结构

```python
class MaterialSummaryArtifact(BaseModel):
    """最终存入数据库的 Artifact 完整结构"""
    type: str = "MATERIAL_SUMMARY"
    version: int                            # 版本号（驳回重生成时递增）
    title: str = "材料总结"
    content: MaterialSummaryOutput          # 结构化内容
    status: str = "PENDING_REVIEW"          # DRAFT / PENDING_REVIEW / APPROVED / REJECTED
```

### 输出展示规则

在 Workspace 协作消息区展示摘要：

```
📋 材料总结完成

本次共处理 28 条消息和 3 段背景材料。

核心事实（6 条）：
• 外卖新用户首单转化率从月初的42%下降至月末的35%（来源：运营-张思琪，频次：高频提及）
• 首单引导流程平均耗时从3分钟增加到5分钟（来源：业务数据）

用户问题（4 条）：
• 用户反馈"领了优惠券但在结账页找不到在哪用"（严重程度：高，提及频率：频繁）

冲突点（1 条）：
• 运营认为应增加首单红包激励，产品则担心补贴成本和信息流体验

待确认问题（3 条）：
• 首单转化率下降是否与近期选餐流程改版有关？
• 用户反馈的"找不到优惠券"是哪个页面的入口？

已生成《材料总结》，等待确认。
```
