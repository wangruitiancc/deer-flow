# 本案详情与案由／罪名共同驱动的分析

这是一套跨案由、跨罪名的组织方法，不是预先写死的通用法律要件表。先识别本案需要解决的问题，再选择有依据的关系；不要将全部关系种类机械塞进每个案件。

## 建立本轮分析基线

1. 使用 `law_get_current_matter_summary` 读取已绑定项目的 title、cause、stage、version。cause 是项目记录，不是司法认定；刑事指控、候选罪名、当事人提出的案由与律师分析定性应在本轮说明中区分。工具不提供的信息从本轮用户指示及授权材料核对，不从文件名或标题猜测。
2. 结合本案详情核对：关注哪一方、请求／指控／拟处理事项、已知事实、争议事实、程序阶段、材料覆盖和时间范围。缺少案由／罪名或存在不同候选时，用一次聚焦澄清确认本轮范围；允许并列候选，不能强行锁定唯一结论。
3. 为每个候选案由／罪名形成独立的问题树：需要审查的主体条件、行为／事实要素、主观或客观争议（仅在相关时）、法律效果、可能排除或反驳的路径、程序性问题。具体分支依据本案和所读法律来源选择，不把该目录当所有案件的法定要件。
4. 法律框架必须记录已读的法律材料、适用版本和时间／地域问题。缺乏可靠规范依据时，可以提出**候选分析问题**，但不得称为已核验的法定构成要件、虚构法条编号／引文或宣称现行有效；交付说明须列“框架依据待核验”。先通过 law_search_saved_authorities 查询本案已保存法源，再用 law_read_saved_authority_version 读取固定版本和 SHA 的相关正文；没有结果时说明尚缺法源。法律依据文件也可通过现有授权文件路径读取，路径仅来自本轮已有文件信息，不搜索或打开未授权宿主路径。已保存法源没有专用图谱来源类型，使用 unverified 记录所读摘录及 document/version/SHA，不伪造证据 citation。
5. 案由／罪名、分析立场、法律来源版本或输入材料改变时，比较旧分析基线，明确提出新增、失效或待重核的分支。保留旧版本和相互竞争的分析，不自动删除或把旧人工确认迁移成新框架确认。

## 从法律问题映射到本案材料

围绕“主张／指控 → 争点 → 待审查要件 → 支持／反驳事实 → 证据／引用 → 法律依据”建立可检查的链条。事实、规范、证据、主张和推理各有角色，不因同名而合并。相同主体在不同法律关系中的身份可通过关系 label 表达；只有材料支持为同一实体时才复用 ID。

- 当事人主张保持主张主体；对立陈述并列保留，不由模型挑选一个改写为事实。
- 支持、反驳、矛盾、时间先后、因果分析分别建关系；共同出现不形成关系，先后发生不等于因果。
- 规范适用、满足要件、责任承担均是待复核分析；引用存在不证明要件已满足或举证责任已完成。证明标准、举证责任、期间起算等结论需本案适用依据，不能从通用图结构自动算出。
- 不得把“尚未读取”“未绑定正式引用”“规范尚未核验”“材料相互冲突”“缺乏支持”混成一个证据缺口。用 `legal.questions` 记录具体需要核查的问题，不生成未经授权的调查／诉讼动作。

## 可序列化标注

保留既有 schema_version 1 和所有原字段；以下都是可选的分析标注，新字段需要前后端配套升级，不对旧文件进行静默升级。

顶层 `analysis`：

```json
{"registered_cause":null,"matter_version":1,"case_labels":["本轮核对的案由／候选罪名"],"framework_source_ids":[],"element_node_ids":[],"notes":["法律来源版本、分析立场、候选与未核验事项"]}
```

`case_labels` 是本轮分析标签，不改变案件登记或授权范围。每个 framework_source_id 必须为图谱已有来源；每个 element_node_id 必须为 role=element 的已有节点。没有法律来源时保留空来源并在 notes 说明待核验。notes、来源与模型声明都不产生律师审核凭据。

节点可选 `role`：`subject/act/fact/asset/claim/defense/issue/element/rule/procedure/evidence/other`。原 type/category 继续使用原枚举；role 承载法律分析角色，不扩展权限。

边可选 `legal`：

```json
{"family":"issues","kind":"requires","statement":"analysis_hypothesis","asserted_by":null,"issue_ids":[],"questions":[]}
```

- family：`identity` 主体身份、`rights` 权利义务、`conduct` 行为事实、`assets` 资金标的、`proof` 证据证明、`issues` 争点要件、`procedure` 程序期限、`reasoning` 因果推理。它们是查看视角，不是各案通用的实体法律规则。
- kind：`represents/controls/owes/performs/violates/transfers/holds/secures/supports/contradicts/raises/satisfies/rebuts/applies/precedes/causes/requires/limits/other`。label 始终写本案具体关系，未被枚举覆盖时用 other，不牵强套用。
- statement：`material_record` 材料记载、`party_assertion` 当事人主张、`analysis_hypothesis` 分析假设。它与 EXTRACTED/INFERRED/AMBIGUOUS 是不同维度；不得用任何组合冒充司法认定或律师审核。
- asserted_by 为已有节点 ID 或 null；issue_ids 为去重的已有节点 ID，最多16项；questions 每项最多240码点，最多8项，使用可核查、保持中性的问句。
- 不确定专业分类时省略 legal，交付说明保留“待细分关系”。不要按旧关系 label 自动补成已确定的法律性质。

## 交付前的内容检查

除 `law_validate_graph` 的结构检查外，对照本轮基线核对：是否读到了案件元数据；框架是否对应本案案由／罪名和程序阶段；框架依据与未核验部分是否明确；关键主张能否沿争点／要件追到事实与来源；对立解释是否保留；未读／无法核查材料是否准确披露。结构校验通过不等于这些内容已经正确。不得为了完整链条补造事实、要件满足或引用。

## 多个案由或候选罪名分别形成框架

在 `analysis.frameworks` 中为每个本轮候选建立独立记录：`id/label/case_label/source_ids/element_node_ids/issue_node_ids`。case_label 必须在 analysis.case_labels 中；element_node_ids 必须对应 role=element，issue_node_ids 必须对应 role=issue。每个框架只列该候选的本案争点、待审查条件和已读来源；最多8个框架，不预置罪名成立。来源缺失时保持空数组并在 notes 说明规范依据待核验。

边的 legal.framework_ids 可关联一个或多个框架；共享事实可复用节点，关系归属仍须显式填写。不要因为事实相同而把不同候选的构成逻辑合并。缺少框架归属的旧关系在“全部关系”中保留，不自动划归某个案由／罪名。界面可以分别查看或对照这些候选；选择框架只改变视图，不改变案件登记或律师审核状态。

analysis.registered_cause 与 matter_version 必须原样取自本轮 law_get_current_matter_summary 的 cause 和 version，不是填写示例值。服务端会在发布／项目保存前比对当前案件；版本或登记案由改变时拒绝旧基线。此时重新读取案件信息并核对框架，不能只修改版本数字绕过变更；旧成果仍保留为历史版本。


## AI 自动编排呈现

生成新图谱时同时生成顶层 `presentation`，让律师打开即看到本案的主题、配色和初始重点，不要求律师先手写搜索条件、配置过滤或设置颜色。按本案详情及候选案由／罪名选取主题，如具体争点的证明对照、某一法律关系、资金往来或候选定性比较；这些只是例子，不机械塞入无关主题。法律分析决定如何呈现，不根据颜色或图形生成法律结论。

```json
{"summary":"说明本案采用的分组方式、阅读顺序和未覆盖事项","default_view_id":"view-1","groups":[{"id":"group-1","label":"本案具体分组名称","color":"#2563eb","node_ids":["existing-node-1"]}],"views":[{"id":"view-1","label":"本案具体争点","description":"为何选这些节点与关系，以及本主题未覆盖什么","layout":"analysis","node_ids":["existing-node-1"],"edge_ids":[]}]}
```

- `summary` 最多1000码点；groups/views 各最多16个，ID 各自唯一，label 最多120码点。颜色仅六位十六进制色值，配色必须能解释其法律分析分组意义，不能将红绿或布局暗示为有罪／无罪、胜诉／败诉或已经核验。
- groups.node_ids 是已有节点的精确稳定 ID，先列优先组；重叠时首组着色。颜色旁有文字图例，专业关系的支持／反驳标识仍保留。可按本案主体身份、争点或材料类别分组，不固定所有案件使用同一套分组。
- views.node_ids 和 edge_ids 分别为明确选中的已有节点及关系；每条关系的两个端点必须都列入本视图。每个视图至少一个节点，节点最多500、关系最多2000，禁止重复、悬空 ID、脚本、正则或任意执行表达式。description 最多1000码点，应解释主题选择与范围。
- layout 为 force 自由关系图或 analysis 法律分析链，由内容决定。default_view_id 为一个已有视图 ID；需要先看全貌时为 null。默认主题应保留与该问题相关的支持、反驳、矛盾与存疑，不通过主题筛选隐去不利事实或把推断当事实。
- 主题筛选只改变显示，所有节点与关系完整保留在同一图谱。前端自动应用默认主题、配色与布局，显示可见／总量并提供完整图谱和恢复 AI 编排入口；手动搜索与过滤仅用于后续微调，不是初始使用前提。
- 更新已有图谱时保留人工修改和稳定 ID，检查原有主题是否仍适用，按本轮明确范围更新编排；不能为美观改写事实或删除对立路径。presentation 必须同时携带有效的 analysis 案件基线；其配置不是律师审核凭据。

`law_validate_graph` 返回 `GRAPH_ANALYSIS_CONTEXT_CHANGED` 时，重新读取本案元数据并检查分析框架、主题和选中范围；不要只递增版本数字后重交。
