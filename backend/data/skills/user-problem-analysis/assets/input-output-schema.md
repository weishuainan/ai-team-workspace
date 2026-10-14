# 用户问题分析 — 输入输出 Schema

## 输入 Schema

```python
class UserProblemAnalysisInput(BaseModel):
    """Skill 03 用户问题分析的输入"""
    project_name: str                         # 项目名称
    project_problem: str                      # 一句话描述问题
    project_goal: str                         # 项目目标

    # 已确认的需求澄清结果
    approved_clarification: Optional[dict]    # 结构化需求

    # 已确认的材料总结
    approved_material_summary: MaterialSummaryOutput   # Skill 02 的输出

    # 当前阶段消息
    messages: list[MessageItem]               # 洞察阶段的补充消息

    # 当前指令
    instruction: str                          # 用户本次 @Agent 的指令
```

### 输入校验规则

1. `approved_material_summary` 必须存在且状态为 `APPROVED`。若不存在，返回 `NEED_HUMAN`，提示"请先完成材料总结并确认后再进行用户问题分析"。
2. 若 `approved_clarification` 不存在（跳过了需求澄清阶段），仍可执行，但需在输出的 `open_questions` 中标注"未进行需求澄清，目标用户和场景信息可能不完整"。
3. 若材料总结的 `coverage_assessment` 为"不足"，仍可执行，但在输出的 `analysis_confidence` 中标注"低"，并在 `open_questions` 中提示补充材料。

---

## 输出 Schema

```python
class UserProblemAnalysisOutput(BaseModel):
    """Skill 03 用户问题分析的结构化输出"""

    # === 用户定义 ===
    user_profiles: list[UserProfile]           # 用户画像（谁）

    # === 场景定义 ===
    scenarios: list[Scenario]                  # 使用场景（在什么情况下）

    # === 问题定义 ===
    pain_points: list[PainPoint]               # 用户痛点（遇到了什么）

    # === 原因分析 ===
    known_facts: list[FactRef]                 # 已知事实（支持原因分析的客观数据）
    cause_hypotheses: list[CauseHypothesis]    # 原因假设（为什么会出现这些问题）

    # === 开放问题 ===
    open_questions: list[OpenQuestion]         # 待验证问题

    # === 机会识别 ===
    opportunities: list[Opportunity]           # 潜在机会点

    # === 质量元数据 ===
    analysis_confidence: str                   # 分析置信度：high / medium / low
    fact_hypothesis_separation: bool           # 是否做到事实与假设完全分离
    coverage_assessment: str                   # 覆盖度自评


class UserProfile(BaseModel):
    """用户画像"""
    user_type: str                             # 用户类型名称
    characteristics: list[str]                 # 特征描述
    current_behavior: str                      # 当前行为模式
    source: str                                # 信息来源


class Scenario(BaseModel):
    """使用场景"""
    scenario_name: str                         # 场景名称
    trigger: str                               # 触发条件
    user_action: str                           # 用户当前的操作行为
    expected_outcome: str                      # 用户期望的结果
    actual_outcome: str                        # 实际结果（可能与期望不一致）
    source: str                                # 信息来源


class PainPoint(BaseModel):
    """用户痛点"""
    pain_description: str                      # 痛点描述
    affected_user: str                         # 受影响的用户群体
    scenario: str                              # 发生场景
    impact_level: str                          # high / medium / low
    evidence: str                              # 支撑证据
    frequency: str                             # frequent / occasional / rare / unknown


class FactRef(BaseModel):
    """已知事实引用"""
    fact: str                                  # 事实内容
    source: str                                # 来源（引用材料总结中的 core_facts）
    relevance: str                             # 与当前问题的关联说明


class CauseHypothesis(BaseModel):
    """原因假设"""
    hypothesis_id: str                         # 假设编号（如 H1, H2）
    hypothesis_type: str                       # judgment（判断）/ hypothesis（假设）
    description: str                           # 原因假设描述
    supporting_facts: list[str]                # 支撑该假设的已知事实
    supporting_evidence: str                   # 支撑论据
    contradicting_evidence: str                # 反面论据（如有）
    confidence: str                            # high / medium / low
    verification_method: str                   # 建议的验证方式


class OpenQuestion(BaseModel):
    """待验证问题"""
    question: str                              # 问题描述
    related_hypothesis: str                    # 关联的假设编号
    verification_suggestion: str               # 建议的验证方向
    priority: str                              # high / medium / low
    blocking: bool                             # 是否阻塞后续阶段推进


class Opportunity(BaseModel):
    """潜在机会点"""
    opportunity: str                           # 机会描述
    related_pain: str                          # 关联的痛点
    potential_impact: str                      # 潜在影响
    feasibility: str                           # high / medium / low / unknown
    source: str                                # 信息来源
```

---

## Artifact 结构

```python
class UserProblemAnalysisArtifact(BaseModel):
    """最终存入数据库的 Artifact 完整结构"""
    type: str = "USER_PROBLEM_ANALYSIS"
    version: int
    title: str = "用户问题分析"
    content: UserProblemAnalysisOutput
    status: str = "PENDING_REVIEW"
```

### 输出展示规则

在 Workspace 协作消息区展示摘要：

```
🔍 用户问题分析完成

用户画像：
① 外卖新用户 — 首次使用外卖App点餐的C端用户，对优惠券和下单流程不熟悉

核心场景：
① 首单下单场景 — 用户首次打开外卖App后触发，期望快速便宜地下第一单，实际在选餐到结账环节花费5分钟以上且找不到优惠券入口

用户痛点（3 条）：
① 首单下单流程过长，用户在结账环节流失（影响：高 | 频率：频繁）
② 领了优惠券但在结账页找不到使用入口（影响：高 | 频率：频繁）

原因假设：
[H1 判断] 选餐流程改版导致下单步骤增加，用户耐心耗尽中途流失
  支撑事实：下单耗时从3分钟增至5分钟；首单转化率从42%降至35%
  置信度：中 | 建议验证：对比新旧版本各步骤的流失率数据

[H2 假设] 首页放置首单红包入口+优惠前置可能提升转化
  置信度：低 | 建议验证：设计A/B测试验证

待验证问题：
① 首单转化率下降是否与选餐流程改版直接相关？（关联H1 | 阻塞：否）
② 新版下单各步骤的流失率分布如何？（关联H1 | 阻塞：否）

已生成《用户问题分析》，等待确认。
```
