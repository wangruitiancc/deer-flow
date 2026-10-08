# Matrix Law Codex 式法律项目树设计 QA

final result: passed
+

## 2026-09-14 平台运营控制台 P0

- 实现 URL：`http://127.0.0.1:2035/admin`；独立于 `/workspace/**` 的平台控制面。
- 实际浏览器检查：Chrome 全页截图 1517 × 1022 px；深绿色固定侧栏、暖白内容面、四项指标卡与审核队列表格均无重叠、截断或横向溢出。
- 信息层级：运营总览为当前可用模块；律所审核、律师审核、租户与成员入口保留产品结构；模型路由、计量与账本、审计中心明确标为“规划中”，未伪装为可用功能。
- 权限边界：页面文案明确平台视图不展示案件正文、附件或提示词；`/admin` 的服务端布局只允许 `system_role=admin`。
- 真实交互：临时管理员登录后成功打开运营台；空队列和四项零值指标正确显示；律所申请端到端提交、平台列表、审核通过、租户开通和申请人租户可见性均通过。
- 数据恢复：视觉与接口测试的临时账号、租户和申请记录已清除，网关重启后 `setup-status` 返回 `needs_setup: true`。
- 验证：Next.js 生产构建通过；扩展两份源码的定向测试各 28 项通过；迁移头为 `0018_platform_onboarding`，两张新表均启用强制 RLS。

final result: passed


## 对比目标

- Source visual truth path: `/var/folders/1l/8h6qxk3x7ndbmytvv3pgylww0000gn/T/codex-clipboard-b4121678-ff76-4d7b-8da2-90a9c4545c93.png`
- Implementation URL: `http://127.0.0.1:2030/workspace/chats/aa2dcfe5-d883-43c2-95c9-0d97f32c4f25`
- Implementation browser capture: Chrome tab `125932137`, 2026-09-06；CUA 运行内截图，工具未提供文件系统落盘路径
- Source pixels: `1880 × 1048`
- Implementation capture pixels: `1330 × 720`
- CSS viewport: 当前 Chrome 内容区约 `1330 × 720`；device scale factor 未由当前浏览器表面暴露
- Density normalization: 以左侧栏占整窗比例和同一“项目展开、会话选中”状态比较，不比较浏览器外框像素
- State: 深色主题；一个法律项目展开；其绑定会话被选中；中间为已有会话

## 全视图对比

参考图的核心信息架构是左侧项目树、中间会话、右侧成果。实现保留 DeerFlow 的中间会话和按需打开的
右侧成果区，只把左侧导航改成 `law_matter → bound thread` 两层树。参考图左栏约占窗口宽度 20%，实现
约占 19%，主区域比例相近。右侧成果区在当前会话没有已选 artifact 时保持关闭，是 DeerFlow 的既有
按需状态，不属于本轮项目树偏差。

## 聚焦区域对比

聚焦比较了左侧栏：品牌位、组织/项目层级、文件夹展开箭头、子会话缩进、选中态和项目内新增入口。
这些细节在全视图中仍清晰可读，因此不再截取第二份局部图。

## Findings

- 无 P0/P1/P2/P3 问题。
- 上一轮发现的法律主页重复事项列表已在 Shell-2 移除；项目树现在是组织、项目和会话的唯一导航。

## 必查表面

- Fonts and typography: 继续使用 Matrix Law 现有字体和字号；层级清晰，项目标题和会话标题均有截断。
- Spacing and layout rhythm: 左栏比例、项目缩进和会话选中态与参考结构一致；长标题不会撑宽侧栏。
- Colors and visual tokens: 使用现有 Matrix Law 深色 token，不复制 Codex 蓝黑配色；对比度和选中态清晰。
- Image quality and asset fidelity: 参考界面没有需要迁移的位图资产；图标沿用项目现有 Lucide 图标库，无占位图。
- Copy and content: 使用“组织、项目、法律工作、文书起草”等法律语义，没有带入 Pull Request 等开发工具文案。

## Primary interactions tested

- 刷新 `/workspace/law` 后加载组织和法律项目；
- 展开“律师函”项目后加载其绑定会话；
- 显示真实会话标题 `hello`；
- 点击会话进入 `/workspace/chats/{thread_id}`；
- 会话页反向定位并保持所属项目展开和会话选中；
- 点击项目进入带 tenant/matter 参数的项目主页，刷新可恢复当前项目；
- 项目主页中央只显示当前项目概览、证据、成员与会话，不再重复项目列表；
- 页面无错误提示，前端容器日志未见本轮组件错误；当前 CUA 表面未暴露浏览器控制台读取能力。

## Comparison history

- Iteration 1: 参考图与首个生产渲染对比；未发现需修复的 P0/P1/P2，未进行视觉返工。

## Implementation Checklist

- [x] 法律组织切换
- [x] 法律项目搜索
- [x] 项目展开与绑定会话加载
- [x] 当前会话反向定位
- [x] 项目内新建会话入口
- [x] 桌面真实页面验证
- [x] Shell-2 收敛法律主页重复列表

## Follow-up Polish

- 将项目状态、未读运行状态和归档入口加入项目节点，但不增加侧栏视觉噪音。
- 项目级成果进入下一轮数据契约和右侧成果区设计，不在项目主页伪造静态成果卡片。

## 2026-09-06 P1 保存弹窗与窄屏工具栏

- 范围：DeerFlow 原生 ArtifactFileDetail 工具栏的项目保存入口，不是整个法律产品重新验收。
- 环境：本地生产构建 `127.0.0.1:2034`，Chromium 拦截合成 API；不是当前 2030 的真实后端。
- 桌面 1280×720 浅色、手机 390×844 深色：显示目标项目/来源文件、名称/类型选择、提交未审核版本均通过。
- 初次窄屏检查发现按钮挤压，已增加工具栏自然换行与文件名截断；复查所有按钮可见且不重叠。
- 表单使用既有 Dialog/Input/Button 和主题 token，错误使用 role=alert，待处理时禁用重复提交和关闭。
- 测试：`frontend/tests/e2e/law-project-artifact-save.spec.ts`，2 项 Chromium 测试通过。
- 截图：`frontend/test-results/law-project-artifact-save--c3441-ewed-project-note-at-1280px-chromium/project-artifact-save.png`
  与 `frontend/test-results/law-project-artifact-save--ad384-iewed-project-note-at-390px-chromium/project-artifact-toolbar.png`；
  测试产物会被后续重跑替换，可由上述测试重新生成。
- 结论：本轮保存交互及上述两种视口通过；项目成果浏览、历史版本预览、其他视口及真实后端联调仍待完成。

## 2026-09-06 P1 跨会话成果与历史预览

- 延用既有成果区、Tabs/Button、主题 token 和 Markdown renderer，不新增独立文书工作台。
- 桌面 1280×720 浅色与手机 390×844 深色真实 Chromium 截图检查：版本下拉、来源提示、下载按钮和正文均无重叠；移动端沿用原生侧抽屉。
- 合成 API 验证：当前会话无临时文件仍能打开；项目列表选择成果、第二版切换第一版、来源会话失效后仍保留快照、撤销下载权限后重新请求被拒绝。
- `law-project-artifact-browse.spec.ts` 2 项与保存流程 2 项共 4 项通过；1233 项前端回归通过，静态检查通过。
- 截图位于 `frontend/test-results/law-project-artifact-brows-9f657-o-temporary-files-at-1280px-chromium/project-artifact-history.png`
  和 `frontend/test-results/law-project-artifact-brows-45b4f-no-temporary-files-at-390px-chromium/project-artifact-history.png`；可用测试重新生成。
- 边界：只验收本轮成果交互，左侧合成租户树不作产品验收；测试接口是替身，不代表 2030 部署、真实存储/扫描器或跨租户全栈通过。

## 2026-09-06 P1 真实浏览器与存储联调

- 2035 Docker 环境，Chromium 1280×720 浅色和 390×844 深色，各一项完整流程通过；截图检查无重叠或越界。
- 不拦截 API：真实登录/CSRF、原生完整文件读取、保存、刷新追加、另一会话历史第一版预览、下载 SHA 校验及来源返回。
- 定位并修复候选前端 SSR 指向 localhost 的配置错误；修复 Gateway history 漏掉 `artifacts` 导致刷新丢目录的问题。
- 截图位于 `frontend/test-results/project-artifacts-real/matrix-law-project-artifac-98660-ugh-real-services-at-1280px-chromium/real-project-history.png`
  及 `frontend/test-results/project-artifacts-real/matrix-law-project-artifac-f0c63-ough-real-services-at-390px-chromium/real-project-history.png`，可由专用配置重跑生成。
- 初始文件/消息为合成播种，模型只是不可执行的 graph 结构占位；不代表 Agent 生成质量、2030 切换或生产部署验收。

## 2026-09-23 会话右栏项目材料与受控 PDF OCR

- Source visual truth path: `/var/folders/1l/8h6qxk3x7ndbmytvv3pgylww0000gn/T/codex-clipboard-ccfbab18-3211-4441-b40f-ce54ae22ad10.png`
- Implementation screenshot path: `/Users/wangruitian/Documents/Project/matrix-law-deerflow/docs/research/lawyer-document-workspace-ocr-qa-overlay-2026-09-23.jpg`
- Rotation-state screenshot path: `/Users/wangruitian/Documents/Project/matrix-law-deerflow/docs/research/lawyer-document-workspace-ocr-qa-rotated-2026-09-23.jpg`
- Implementation URL during QA: `http://127.0.0.1:4121/qa/ocr-workspace`；一次性本地 QA 路由，验收后已删除。
- Viewport: Chrome CSS `1818 × 1103`，`devicePixelRatio=0.9`；截图 `2002 × 1226`。
- Source pixels: `2360 × 1610`；implementation pixels: `2002 × 1226`。按右栏占整窗比例、相同深色主题和相同会话/右栏展开状态归一化；不对浏览器缩放造成的绝对像素差做虚假精确比较。
- State: 深色桌面会话；右栏展开并选中“项目材料”；三页 PDF 第 1 页；正常状态显示 OCR 框，旋转状态为 90° 并隐藏旧框。

### 全视图对比

源图的会话区与右栏约为 60:40，右栏顶部是一行文件/成果/模板/图谱入口。实现保持同一双栏构图、深色 token 和紧凑顶部控件，只在同级文件导航中增加“项目材料”，没有把 OCR 按钮堆进全局会话顶栏。项目材料内部以证据工作台标题、主操作、页码/旋转工具和 PDF 原文顺序展开，视觉层级与原文件面板一致。

### 聚焦区域对比

聚焦检查右栏顶部标签、证据工作台工具条、A4 画布和 OCR bbox。标签在当前宽度可读且可换行；PDF 白色页面与深色承载面形成清晰边界；框线采用既有主色，引用高亮使用琥珀色。旋转 90° 后框层消失并出现说明条，未把旧坐标错误套到新方向。

### Findings

- 无 P0/P1/P2 问题。
- 残余测试缺口不是本次桌面视觉阻断项：尚未在移动端实机、真实受保护材料和候选两服务器环境复验。

### 必查表面

- Fonts and typography: 沿用 Matrix Law 现有字体、字重和小字号层级；未引入 PDF 专用字体影响工作台 UI。合成 PDF 中文清晰，没有乱码或异常替代字形。
- Spacing and layout rhythm: 延续源图右栏的紧凑标签和横向操作密度；标题、工具条与页面画布间距一致，长页面由栏内滚动承载，不遮挡持久控件。
- Colors and visual tokens: 使用现有深色背景、边框、按钮与语义状态 token；PDF 画布保持白底，bbox 和引用高亮对比度足够。
- Image quality and asset fidelity: 没有用占位 SVG 或 CSS 图形替代 PDF；页面由 PDF.js canvas 实际渲染，缩放后文字与边缘清晰。
- Copy and content: 新增文案均为中文法律工作语义；“项目材料”“证据工作台”“开始 OCR”和方向失效提示能够说明对象、动作和风险。

### Primary interactions tested

- 三页合成 PDF 从 `1 / 3` 进入 `2 / 3`、`3 / 3`，末页“下一页”禁用；
- 从末页返回第 1 页；
- 第 1 页 0° 显示 OCR bbox 和引用高亮；
- 旋转到 90° 后 PDF 页面真实旋转，旧 OCR 框隐藏并出现重新识别提示；
- 浏览器 DOM 可访问名称包含上一页、下一页、旋转当前页、项目材料和开始 OCR；
- Chrome `tab.dev.logs` 检查 `error`、`warning` 为 0。

### Comparison history

- Iteration 1: 首份 QA 临时承载页漏画源截图已有的“用模板起草”入口；正式 `ProjectArtifactsPanel` 源码并未删除该入口，但截图证据与目标状态不一致，按 P2 证据偏差处理，未用于最终通过结论。
- Fix: 修正一次性 QA 承载页，同时显示“本会话文件 / 项目已保存成果 / 项目材料 / 用模板起草 / 生成案情图谱”，保持正式组件的入口集合。
- Iteration 2: 在相同 Chrome 视口重新捕获正常与 90° 状态；源入口均保留，新增项目材料层级清晰，无剩余 P0/P1/P2，控制台 error/warn 仍为 0。

### Implementation Checklist

- [x] 会话右栏增加项目材料入口
- [x] 复用 tenant/matter 授权上下文与证据工作台
- [x] PDF.js 受控 canvas 和真实页码
- [x] PDF 元数据旋转与 OCR 校正角度合成
- [x] OCR bbox 与 citation anchor 高亮
- [x] 方向草稿不一致时 fail closed 隐藏旧框
- [x] 三页桌面浏览器交互与控制台检查

### Follow-up Polish

- 候选部署后补真实受保护 PDF、移动端抽屉和窄宽度长标题的截图；这些属于后续完整候选验收，不阻塞本轮源码交付。

final result: passed


## 2026-10-03 — Lawyer three-column document workspace

Scope: approved overview/file-tab layout in the existing Web lawyer application, plus both draggable column dividers. The earlier reports above remain unchanged.

Reference: `../matrix-law-deerflow/docs/assets/legal-workspace-redesign-20261003.png`. The mock uses illustrative contract/chat content; the candidate deliberately uses a synthetic formula matter, a blank conversation, existing account/theme, and actual protected resources. No mock legal claims or model-use badges were fabricated in the implementation.

### Source and visual review

- Layout: fixed overview tab, closable document tabs, separate original/proofreading controls, grouped results/materials/work entries. Both dividers expose labels and resize cursors; left keyboard, double-click reset and remembered desktop size, right remembered ratio. The original single chat/resizable panel tree stays mounted when expanded or moved to mobile.
- Typography: existing product font and Matrix Law wordmark retained; headings and muted context labels follow current components. This is an intentional existing-design-system adaptation rather than a pixel match to the illustrative raster.
- Tokens: retained existing dark/light background, border, muted and primary tokens. Navy mock shading was not hardcoded over the application's theme.
- Icons: real Lucide folder/file/plus/expand/close/resize icons. No decorative raster text or fake file previews.
- Copy and boundaries: structured human uploads labeled as conversation attachments with an explicit analysis-use caveat. Manually opened evidence labeled separately. Empty sources/results remain visibly empty; project history/all evidence are separate actions. Review/publication scope and conflict protection remain intact.
- P2 fixes during browser QA: width hydration reset corrected by mounting the panel after loading the browser preference; proofreading publication header uses the OCR container width rather than the outer viewport; desktop sidebar preference is not overwritten by a temporary narrow viewport.

### Verification

19 targeted tests passed; TypeScript, targeted ESLint and Prettier passed. Browser verification used protected synthetic PDF data: dragging both dividers, refresh position recovery, tab switching, original page 2 and 1.5x zoom preserved across overview/fullscreen/mobile return, full-viewport expanded bounds, and close-save confirmation. Mobile body/document widths matched without outer horizontal overflow.

An additional pre-existing product-boundary test fails because it expects an admin redirect guard absent from both current HEAD and working source in workspace/layout.tsx. That file was not changed here; this is recorded rather than counted as a pass. Synthetic browser review does not certify W5 OCR quality, real quota continuation, production facilities or real legal content.

Final rendered screenshots and comparison are stored under `../matrix-law-deerflow/docs/assets/` with the `legal-workspace-20261003-` prefix. W5 remains paused and incomplete.
