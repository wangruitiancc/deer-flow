# Matrix-Law

Matrix-Law 是面向律师、法务团队与法律机构的多租户法律 Agent 系统。法律功能复用平台已有的
Agent、会话、工具、Skill、文件和右侧成果框架，不移植旧桌面运行器，也不对外提供通用 Agent 产品。

## 产品硬边界

- 用户唯一工作入口是 `/workspace/law` 法律工作台，既支持案件，也支持单次咨询、合同审核、法律
  研究、文书起草等零散法律任务。
- 每个可运行会话必须由服务端绑定到有效 tenant、法律事项、thread owner、tenant membership 和
  事项成员权限；浏览器提交的 tenant/事项标识不是授权依据。
- 未绑定法律事项、无权限、事项归档、法律扩展缺失或准入异常时，在持久化 run 之前 fail closed。
- 主 Agent 与子任务的每次模型调用都会注入 Matrix-Law 法律专用系统策略；非法律请求应拒绝并要求
  用户说明与当前法律工作的关系。
- 运行接口只允许固定 `lead_agent`，不允许选择或注入自定义 Agent。
- Agents、Assistants、Channels、Integrations、MCP、Memory、Scheduled Tasks、Skills 和 Subagents
  通用控制面在 Matrix-Law 产品模式下不挂载。
- 法律托管模式下，模型与 MCP 只能来自能力平台签发的受控 runtime binding；本仓库本地
  `extensions_config.json`、用户 MCP/Skill 安装和上游密钥配置不能作为律所或律师的外借能力入口。
- 能力服务器同步并授权的模型名不要求重复写入宿主静态模型表；仅当法律受控模型准入已启用时，
  宿主才把模型选择交给法律扩展和能力 Gateway 逐层校验，独立 harness 模式仍严格使用静态白名单。
- AI 输出是待授权法律专业人员复核的工作成果，不是最终法律意见。

底层仍可使用 subagent、sandbox、模型适配、受控工具和流式执行，但这些只是法律 Agent 的内部
实现能力，不能绕过法律工作准入，也不构成面向其他业务的能力承诺。

工作台左侧采用常驻图标栏与独立案件树：收起案件树后，展开按钮、案件与会话、搜索、设置及
登录头像仍可使用。品牌旁的工作区菜单提供法律工作、能力用量和设置入口；律所后台按成员角色显示。
历史按钮会展开案件树并定位最近会话；最近列表复用原生会话查询，并核对当前组织、可访问案件和
有效会话绑定，默认显示五条，可展开本次检查的最多十二条候选。更多菜单连接现有外观设置与关于页面。
中间保留会话，文档校对、录音转写、图谱及文书分别在右侧页签中处理。

托管 PostgreSQL 部署将 `database.auto_migrate` 设为 `false`：Gateway lifespan 只读核对 DeerFlow、LangGraph
schema 是否到当前版本；缺表或版本落后时拒绝启动。发布运维必须先显式运行租户迁移 one-shot，覆盖 ORM、LangGraph
checkpointer/store、法律扩展和 runtime role，再启动 Gateway。开发及本机容器模拟仍可在显式准备阶段执行迁移。

W12→W13 的应用回退兼容版本仍只读检查数据库：仅对源码中明确审核的未来 revision，额外核对完整 PostgreSQL catalog 摘要；未知版本、字段、RLS、grant 或角色变化均拒绝启动。兼容版本必须先于 W13 数据迁移交付，不代表原 W12 包已自动具备兼容性。

## 核心模块

- 法律模板：`/matrix-law-templates` 可选择六种内置法律 Markdown 模板，按需读取资源，
  通过原生文件工具在右侧交付工作草稿；项目保存仍需用户确认。会见/庭审/出具等事实日期
  没有输入时待填写，不用创建日期替代。隔离部署/真实模型验收以兄弟项目开发日志为准；
  项目内模板选择界面、租户自定义模板 CRUD 与旧自定义模板导入尚未完成。
  针对两轮模型复制擅增字段的问题，新增法律扩展工具 `law_create_template_draft`：
  代码准确替换变量，宿主沙箱生成并回读新文件，工具直接调用原生 present_files 展示（含真实交付回执）。
  不覆盖旧稿、不自动存项目、不把模型运行 success 当作模板保真度证明。

- 法律图谱：复用平台 Skill、工具和右侧成果区；镜像包含 `matrix-law-graph` Skill，
  通过 `/matrix-law-graph` 激活。G4 的七个材料/引用工具及原生加载已在隔离 2035 验证，
  真实模型的合成口述及 OCR 表格驱动图谱、精确引文、扫描保存已通过；右侧画布/时间线可用，
  晚到工具错误归组和矮窗口详情遮挡已修复。完整停止/重试、真实 OCR 精度和法律质量尚待验收，2030 尚未升级图谱版本。
- 旧图谱迁移：右侧“项目已保存成果 → 转换旧图谱”本地预览并下载新图谱及 SHA/ID 报告，
  也可明确放入原生会话草稿。只有普通发送才上传并运行，已有草稿/附件不覆盖。
  2035 已通过真实浏览器发送、模型读取/校验/写文件、右侧预览和扫描保存的合成验收；
  初始旧来源仍未映射、日期依据待核验；2035 已增加人工选择已有项目引用、读取原文并确认的映射，
  仅改原生草稿，保存新版本且保留未核验旧摘录。Skill 已明确更新时保留稳定来源 ID 和 legacy_origin，
  分析依赖来源时重读受保护引用；合成真实模型首轮回读/保留/扫描保存通过，复跑发现模型跳过
  law_validate_graph 后发布文件，验收拒绝并未继续保存。源码改用现有配置级原生中间件
  LawEnforcementMiddleware 执行发布前校验；普通观察型插件包装不能拦截，必须显式配置该入口。
  执行验证不依赖模型是否主动调用校验工具。部署/回归状态见验证记录，
  不等于稳定迁移或法律质量验收。
- 项目成果 P1：法律扩展增加不可变版本、保存/追加/列表/受保护下载 API，复用宿主 thread 文件成果。
  来源暂为 `client_asserted`，保存不等于审核通过；原生右侧成果保存、跨会话浏览和只读历史版本已部署到 2030。
- P1 独立合成环境位于本机 2035，真实存储/扫描/权限 HTTP 验证已通过；配置和重现命令见
  [P1 全栈验证](docker/matrix-law-project-artifacts/README.md)。2030 主入口现已升级：保留原数据和模型配置，切换前通过真实桌面/手机浏览器验证，切换后真实模型生成合成文件、扫描保存及下载字节校验通过；仍非生产验收。
- 会话历史读取保留原生 `artifacts` 状态（包括空列表），保证刷新后仍可恢复会话文件目录。
- `backend/extensions/sources/matrix-law-extension/`：租户、法律事项、成员权限、材料、OCR、引用、审计、
  RLS、法律工作准入及法律系统策略。
- `backend/app/gateway/`：认证、固定法律 Agent 运行边界、三层并发容量、健康与指标。租户端本地密码管理员可由 `AUTH_MFA_REQUIRED_FOR_ADMINS` 强制使用 TOTP；该设置不覆盖 OIDC 管理员和 Matrix 能力平台运营台，及密钥/恢复要求见 [本地管理员 MFA 说明](backend/docs/ADMIN_MFA.md)。
- `frontend/src/app/workspace/law/` 与 `frontend/src/core/law/`：多租户法律工作 Web 工作台。
- `services/matrix-ocr/`、`services/matrix-structure/`：私有 OCR 与结构识别服务。
- `deploy/helm/deer-flow/`：Matrix-Law 服务端部署模板。

## 本地开发

```bash
make setup
make check
```

前端：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
```

后端：

```bash
cd backend
uv sync --locked --extra postgres
uv run pytest -q
uv run pytest -q tests/blocking_io

# Matrix Law W19: abrupt Gateway process termination and persisted run recovery
.venv/bin/python tests/w19_gateway_process_crash_recovery.py
```

隔离的正式镜像黑盒：

```bash
docker build -t matrix-law-phase10j-gateway:verify -f backend/Dockerfile .
docker compose -f docker/docker-compose.matrix-law-phase10j.yaml up -d --wait gateway
docker compose -f docker/docker-compose.matrix-law-phase10j.yaml run --rm probe
docker compose -f docker/docker-compose.matrix-law-phase10j.yaml down -v
```

## 当前验收边界

律师会话右侧工作区正在按 UI 标准 v1 接入：文档校对、录音／实时转写、案情图谱、文书撰写采用独立功能页签，日程、法律依据和记忆由“＋”打开。主强调色统一为灰蓝，账号头像包含设置与退出，外观支持手动、系统或按所选城市日出日落切换。本轮为源码与本地合成界面验证，尚未发布到云端；详细范围见 `frontend/design-qa.md` 与配套 Matrix Law 设计记录。

录音机器预览采用限高滚动区，默认跟随最新窗口；向上阅读时暂停跟随，可点击“回到最新”恢复。“已识别”时长仅累计已有识别结果的窗口，未完成窗口和中间缺口不计入。本轮可见性与时钟测试是本地验证，目标服务器的混合负载时延仍单独验收。

本地自动化、隔离 PostgreSQL、生产镜像和容器安全合同可以在本仓库验证。接入真实案件前仍必须在
目标环境完成 OIDC/SSO、KMS/KES、对象存储、私有 OCR、真实法律金标、渗透、生产等价负载、
Prometheus/Alertmanager、Kubernetes 多副本与跨机灾备验收。

## 上游与许可

执行引擎源自 [ByteDance DeerFlow](https://github.com/bytedance/deer-flow)，遵循仓库中的 MIT License。
保留上游版权、许可证与必要归属；用户界面和产品说明统一使用 Matrix-Law 品牌。
