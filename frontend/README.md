# Matrix-Law Web

2026-10-16 图谱源码候选升级：本案详情与登记案由／候选罪名共同驱动分析，分别关联争点、待审查要件、事实、证据和法律依据。新增可视框架管理与依据面板、专业关系分层、自由关系与法律分析链布局。AI 随图谱生成本案主题筛选、颜色分组与初始布局，打开自动应用，提供全图和恢复 AI 编排；手动查询、分组及外观／力参数用于微调。专业字段需前后端配套发布，案件元数据变化时服务端拒绝旧分析基线；未部署或发布新受管包，真实模型与法律质量仍待验。设计与验证记录位于 Matrix Law 仓库 `docs/design/legal-graph-case-framework-upgrade.md`。

会话 61：500 条真实模型导入、原生完整加载、依据与报告分别保存及历史原字节下载通过（19.6 秒），修复 2035 法律上传入口 413 后真实桌面/手机联合 10 项通过。
只改测试和法律部署入口，不另建 Agent 或文件仓；模型占位已恢复，官方核验、跨版本连续性和其余功能迁移继续。

会话 59 已将 56–58 的确定性导入链路配套部署到隔离 2035，并配置有界写入预算；新数据备份恢复/51 表不变核验通过。
会话 60 部署后真实服务联合 10 项、严格 MiniMax 小样本精确交付/依据扫描保存与历史 1 项通过，已恢复占位；大文件运行、官方核验和完整迁移仍待续。2030 主环境不变，以下是历史阶段记录。

会话 58：旧法条导入的固定发送说明已改为专用 `law_import_authorities`，两份完整附件仍须确认后由用户普通发送。
真实模型验收用例已改为匹配本次附件路径、工具调用 ID 与代码计算回执；保留原字节、原生发布与扫描保存/历史检查。
前端源码/生产构建及合成浏览器回归通过，尚未配套部署；不代表下方真实模型失败已经解决到运行环境。

会话 55：普通 Send 的真实模型导入未通过完整字节验收，依据文件丢失尾换行；未进入项目保存。
隔离环境已恢复占位模型。后续使用原生字节能力做确定性交付，当前“原样复制”说明不是可验证完成证明。

会话 54：48–53 法律依据增量已配套部署隔离 2035；项目尚未完成核验时禁用旧收藏导入入口，避免弹窗被加载刷新关闭。
桌面/手机真实 API 专项 2 项及联合 10 项通过，下载报告、原生草稿、编辑/扫描保存/旧版回读及跨租户拒绝已验证。
后半段文件为明确合成播种，不是实际模型交付验收；模型完整导入、官方核验与其他模块继续。以下为历史阶段记录。

会话 53：项目成果区新增“导入旧法条收藏”：本地预览、完整报告下载，重新核验项目权限后显式放入原生会话草稿。
确认包含原始记录的隐私范围，不自动上传、运行或保存。48–53 未部署；真实模型原样输出及保存仍待联合验收。

会话 52：法律依据支持旧收藏“仅引用、正文缺失”的展示和人工补摘要，保留旧来源与空字段。
纯转换核心可保留全部旧记录、重复项、BOM/CRLF 和源/输出摘要报告，不访问旧路径或补造条文。
导入选择/预览/交付入口仍待接线，尚未部署，不能称为旧项目已导入；新格式须前后端配套升级。

会话 51 为 `.law-authorities.json` 增加手工/来源收录、条目/研究问题编辑和移除恢复表单，
沿用原生内存草稿/文件保存和项目历史，不新增编辑器或 Agent。长表单正文独立滚动，固定标题/确认区。
来源 SHA、日期依据、格式检查不等于法律核验；只保留已保存版本中的移除原因。跨版本连续性、官方核验及旧引用导入待续。
这些法律依据增量未部署；下述 2035 仍为模板候选。前端合成浏览器测试不代表真实模型或业务权限联合验收。

当前隔离 2035 已部署模板新建/导入/管理/选版共享。真实 cookie/CSRF/API/存储/扫描联合浏览器
8 项通过，新增管理测试覆盖桌面与手机；单独 opt-in 真实模型测试从界面导入开始，验收普通发送、
填值、右侧原生编辑、模板版本与未审核项目保存。不是批量旧项目迁移、完整角色矩阵或法律质量验收。
2030 仍停止且未升级；以下历史阶段结果不代表当前主入口在线。

会话 41（W10 进行中）：工作区源码加入案件 owner/lead/lawyer 对不可变项目成果版本的明确审核，审核回执绑定版本 SHA 并保留追加历史；新版本仍须独立审核。扩展隔离 PostgreSQL 720 项通过/4 外部依赖跳过，前端定向 5 项与 ESLint/TypeScript 检查通过；DOCX/PDF 导出、引用清单、候选部署和完整律师旅程未完成。

Matrix Law 的多租户法律工作台。法律功能复用 DeerFlow 的 Agent、会话、工具、Skill、上传与成果框架；公开界面不提供非法律通用 Agent
模式。用户可以创建案件，也可以创建单次咨询、合同审核、法律研究或文书起草等零散法律事项；
会话绑定到租户内的授权法律事项后进入执行页。

统一登录后，律师进入法律工作台；只有财务管理身份的账号通过现有管理身份接口进入 `/law-admin/` 财务页面。身份读取失败时显示重试，不将其视为新律所，也不创建律师工作空间。

产品可见名称和标记统一使用 Matrix-Law；DeerFlow 仅作为内部框架/技术实现名称出现在开发说明中。

工作台采用法律项目树—当前会话—成果区的三栏结构。左侧“项目”由 `law_matter` 承载，可表示正式
案件、顾问服务主题、合同审核或单次咨询；展开项目后只显示已绑定到该项目的 DeerFlow 会话。

原生文件成果工具栏新增“保存到项目”：核验当前目标项目后新建成果或追加不可变版本，可标为文书、
项目笔记等类型；保存默认未审核，不是定稿。未保存编辑、版本冲突或执行中的任务不能提升为项目成果。
保存会重新下载完整文件，不使用截断预览；失败重试沿用同一内容/目标的幂等键。前后端源码已接通，
同一右侧成果区可切换“本会话文件 / 项目已保存成果”，跨会话浏览已保存成果、切换只读历史版本、
重新鉴权下载及打开来源会话；即使本会话没有临时文件也能打开。历史 Markdown 复用原生预览，
相对链接不跳向当前会话文件。当前 2030 已升级 P1，切换前在 2036 通过真实存储和桌面/手机浏览器验证；正式服务器生产部署仍待完成。

已审核通过的案件文书、法律研究和图谱版本可按来源类型导出 DOCX 或 PDF 回执包。文本与受管结构化
JSON 会生成排版正文；已有 DOCX/PDF 只允许原格式导出，保留原文件字节。ZIP 内包含成果、引用清单、
版本审核回执和摘要校验；案件引用由服务端重新解析，网页/手工来源继续标成未核验。当前是源码与隔离
回归结果，尚未升级本机双服务器候选环境。

2035 独立合成环境已通过真实 Chromium 保存/追加/跨会话历史/下载验证（桌面和手机），命令为
`python3 ../scripts/pnpm.py exec playwright test --config playwright.matrix-law-project-artifacts.config.ts`。
这验证真实 Gateway/存储接口，不使用拦截替身；初始文件由测试播种，不是模型生成验收。

法律图谱 G2 已在源码中接入原生右侧文件预览与项目历史版本：d3-force 关系画布、固定事件时间线、
可访问列表、缩放/平移、分类检索和受保护出处查看。完整 `.law-graph.json` 或 knowledge_graph
历史成果经严格 v1 校验才展示；不从文字猜测日期，不把未核验摘录当证据。G3 可视化编辑已接原生
文件草稿：节点/关系增删改、日期、来源关联、认知状态和非事件固定位置；显式保存文件后再追加项目
版本，冲突保留草稿，历史仍只读。挖掘和旧图谱导入待完成。
320/768/1024/1440px 浏览器测试覆盖深浅色与减少动画；小于 1024px 复用原生抽屉，桌面保持分栏。
本轮 1293 项前端测试、生产构建和 15 项生产前端浏览器回归通过；浏览器接口采用合成替身，
不等同于真实存储/模型验收。随后 G1–G3 已更新独立 2035 镜像，真实桌面/手机图谱与笔记共 4 项
测试通过：文件编辑/刷新、不可变版本、SHA 冲突、伪造引用拒绝、成员撤权及审计。2030 尚未更新，
图谱初始数据仍为合成播种，不是模型生成。后续来源验收使用真实上传/扫描/citation API，
仅 OCR 标准化正文为显式合成记录；已验证同血缘重跑后历史原文、材料归档和重新读取时撤权清空，
并区分原材料状态。法律挖掘、旧图谱导入与识别质量不由这轮验收证明。

旧 CaseGraph 现可在右侧“项目已保存成果 → 转换旧图谱”本地转换、预览与下载。
“放入当前会话草稿”将同一份转换图谱及迁移报告加入原生附件区，并填入可编辑的法律处理说明；
不覆盖已有输入/附件，不自动上传、运行或保存到项目。会再次读取项目权限和原生附件限制，
只有用户点击普通发送才进入既有上传/运行链路。旧来源仍未映射，不据原路径或同名文件建立可信引用。
附件只在内存中；离开会话或刷新后需重新添加，静态文字草稿不包含旧文件名/案件 ID/材料正文。
G5b 在 2035 已通过真实浏览器发送、模型读取两份附件、保留原节点/关系/布局/日期和未映射来源、
原生右侧预览及扫描保存的合成验收。运行后原上传文件未改写，保存下载字节一致；
另已在 2035 接入显式证据映射：原生图谱编辑 → 选择项目材料/证据版本/已有引用 →
读取受保护原文并核对旧摘录 → 确认关联到草稿 → 原生 Save → 保存项目新版本。
不自动匹配或创建 citation，不改变事实/日期依据/审核状态；原记录保留为未核验 `legacy_origin`。
应用前重新鉴权并比较引用正文/来源状态，撤权清空原文，切换选择清除旧确认，关闭中止请求。
仅扩展 v1 可选字段，前后端须配套升级；旧严格客户端不保证读取带新字段的图谱。
真实旧项目全量迁移、映射后模型回读与法律质量仍未验收。2030 不变。

OCR 校对区在发布整份不可变校对版本后，可从发布页选中精确文字创建正式引用。浏览器只提交
publication、物理页和 Unicode 字符范围，服务端重新截取并封存正文；该引用与既有 OCR block 引用
共同出现在材料引用列表，并可直接作为案情图谱/法律依据的 citation 来源。草稿未发布时不能走该入口。

内置法律模板入口位于同一右侧成果区的“用模板起草”。读取已鉴权的部署目录，选择后只准备
当前原生会话输入，明确请求已注册的确定性法律工具，不依赖已关闭的通用 Skill 管理接口。
不自动运行、上传或保存项目版本。确认前重查当前
项目绑定、成员权限和项目状态；已有文字或附件不覆盖，关闭或切换会话中止晚到写入。未知日期
保持待填写，输入草稿不包含租户/项目 ID 或项目私有正文。租户自定义模板 CRUD/导入仍未完成。

模板入口另有独立真实模型验收 `playwright.matrix-law-template-live.config.ts`，只通过兄弟项目
`scripts/verify_live_legal_graph.py --execute-model --with-template-ui` 启动。已经验证一种合成合同
审查模板的真实点选、普通 Send、准确空白正文、原生发布、右侧预览和扫描保存/下载；不是法律
审查质量或租户自定义模板验收。普通六项真实服务回归不启用模型，2030 未升级。

自定义模板的“保存为模板”入口已接在原生 Markdown 文件工具栏（隔离 2035 已部署）。先用原生 Save
落盘，再显式新建个人/组织模板或追加已有版本；完整 UTF-8 原文最多 64 KiB，保留变量，不自动运行
Agent 或安装 Skill。未保存、运行中、冲突文件不可保存为模板；目标版本变化须重新选择。
关闭请求不保证撤销服务器写入，同一内容的失败重试保留幂等键。2035 已配套升级法律迁移 0016，
2030 仍为 0015。一个桌面合成个人历史模板的真实模型精确打开、原生编辑与模板/项目保存已经通过；
完整管理和旧文件导入待继续，不把这一条链路当作完整模板库验收。

右侧模板弹窗区分内置和自定义来源（隔离 2035 已部署）。自定义目录可选历史版本，确认时只准备
“模板选择.json”原生临时附件及固定会话说明，模板 ID/名称不进入持久化草稿；不读取正文，不提前
上传或运行。普通发送才走既有上传/Agent/原生发布链路。版本、角色或项目变化要求重新确认，现有
输入与附件不覆盖。

最新源码在同一弹窗中增加“原样打开／填值起草”，默认原样；填值模式只将验证后的显示值追加到
同一临时附件，日期/时间留空传“待填写”，不使用浏览器或服务器时钟。固定说明不含私人值、名称或 ID；
普通 Send 才上传并调 law_create_custom_template_draft，没有新运行通道或独立正文编辑器。
字段错误可朗读；标题/操作按钮固定、内容滚动。四宽度 mock 浏览器和完整前端测试通过，
这部分已与后端新渲染工具配套部署到隔离 2035；桌面合成模板填值及原样两条真实模型/原生编辑/显式保存流程通过。
填值文件字节准确，但模型对不递归占位符的说明仍有误；完整管理与旧导入未完成，2030 未改。
详见兄弟项目的模板迁移设计和每日日志。

最新源码增加同一弹窗“导入旧模板”：本地检查单个 `.md/.markdown` 文件的 UTF-8/64 KiB、
BOM/完整 SHA 和占位符兼容性，原文只按文本预览；选择个人/组织范围并确认后才调用现有模板保存 API。
成功前受保护回读第一版并比对完整字节，默认个人、不覆盖同名、不运行 Agent 或安装 Skill。
这部分尚未部署；修订的填值说明也尚未做真实模型复验，不把源码/合成测试当作线上已生效。

模板选择中的“管理模板”已接可用/归档目录、重命名、归档和恢复，均显式确认并保留历史正文。
复用现有乐观锁与幂等 PATCH，归档可恢复，同名/版本冲突不覆盖。该入口同样尚未部署；
目录管理内已新增“选版发布组织副本”：管理员明确选择历史正文并预览、核对隐私后，
复用既有共享 API 新建组织副本，不公开个人模板的其他历史，不覆盖同名模板。
成功前回读第一版核对正文；确认区固定显示源版本和副本名称。此入口仍未部署。
管理目录现可“新建空白模板”，空目录也可使用。默认个人、组织限管理员，确认后新建真正的空白
第一版并回读核对 0 字节；不自动生成标题或案件内容，也不启动 Agent。之后从自定义模板选择
原样打开，在右侧既有编辑器编写并保存版本。最新导入/管理/共享/新建入口仍待部署及真实服务联合验收。

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with [App Router](https://nextjs.org/docs/app)
- **UI**: [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [MagicUI](https://magicui.design/) and [React Bits](https://reactbits.dev/)
- **AI Integration**: [LangGraph SDK](https://www.npmjs.com/package/@langchain/langgraph-sdk) and [Vercel AI Elements](https://vercel.com/ai-sdk/ai-elements)

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10.26.2+

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
# Start development server
pnpm dev

# The app will be available at http://localhost:3000
```

### Build & Test

```bash
# Type check
pnpm typecheck

# Check formatting
pnpm format

# Apply formatting
pnpm format:write

# Lint
pnpm lint

# Run unit tests
pnpm test

# One-time setup: install Playwright Chromium browser
pnpm exec playwright install chromium

# Run E2E tests (builds and starts production server automatically)
pnpm test:e2e

# Build for production
pnpm build

# Start production server
pnpm start
```

## Site Map

```
├── /                              # 重定向到 /workspace/law
├── /workspace/law                 # 法律项目主页与项目详情后备页
├── /workspace/chats/[thread_id]   # 仅用于已经绑定授权法律事项的会话
├── /workspace/chats               # 重定向到 /workspace/law
├── /workspace/chats/new           # 重定向到 /workspace/law
├── /workspace/agents/**           # 重定向到 /workspace/law
├── /workspace/scheduled-tasks     # 重定向到 /workspace/law
├── /blog/**                       # 停用通用内容并重定向
├── /[lang]/docs/**                # 停用通用产品文档并重定向
└── /showcase/**                   # 停用通用 Agent 展示并重定向
```

## Configuration

### Environment Variables

Key environment variables (see `.env.example` for full list):

```bash
# Backend API URL (optional, uses local Next.js/nginx proxy by default)
NEXT_PUBLIC_BACKEND_BASE_URL="http://localhost:8001"
# LangGraph-compatible API URL (optional, uses local Next.js/nginx proxy by default)
NEXT_PUBLIC_LANGGRAPH_BASE_URL="http://localhost:8001/api"
```

## Project Structure

```
tests/
├── e2e/                    # E2E tests (Playwright, Chromium, mocked backend)
└── unit/                   # Unit tests (mirrors src/ layout)
src/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes
│   ├── showcase/           # 已停用的上游通用展示路由
│   ├── workspace/          # Main workspace pages
│   └── mock/               # Mock/demo pages
├── components/             # React components
│   ├── ui/                 # Reusable UI components
│   ├── workspace/          # Workspace-specific components
│   ├── landing/            # Landing page components
│   └── ai-elements/        # AI-related UI elements
├── core/                   # Core business logic
│   ├── api/                # API client & data fetching
│   ├── artifacts/          # Artifact management
│   ├── config/              # App configuration
│   ├── i18n/               # Internationalization
│   ├── law/                # Matrix Law API, types, and query hooks
│   ├── mcp/                # 内部执行引擎兼容代码，产品控制面不挂载
│   ├── messages/           # Message handling
│   ├── models/             # Data models & types
│   ├── settings/           # User settings
│   ├── skills/             # 内部执行引擎兼容代码，产品 UI 不暴露
│   ├── threads/            # Thread management
│   ├── todos/              # Todo system
│   └── utils/              # Utility functions
├── hooks/                  # Custom React hooks
├── lib/                    # Shared libraries & utilities
├── server/                 # Server-side code
│   └── better-auth/        # Authentication setup and session helpers
└── styles/                 # Global styles
```

## Scripts

| Command             | Description                           |
| ------------------- | ------------------------------------- |
| `pnpm dev`          | Start development server with Webpack |
| `pnpm build`        | Build for production                  |
| `pnpm start`        | Start production server               |
| `pnpm test`         | Run unit tests with Rstest            |
| `pnpm test:e2e`     | Run E2E tests with Playwright         |
| `pnpm format`       | Check formatting with Prettier        |
| `pnpm format:write` | Apply formatting with Prettier        |
| `pnpm lint`         | Run ESLint                            |
| `pnpm lint:fix`     | Fix ESLint issues                     |
| `pnpm typecheck`    | Run TypeScript type checking          |
| `pnpm check`        | Run both lint and typecheck           |

## Development Notes

- Uses pnpm workspaces (see `packageManager` in package.json)
- Webpack is the default development bundler until the upstream Turbopack PostCSS worker leak is fixed in a stable Next.js release (#5132). Set `DEER_FLOW_DEV_BUNDLER=turbo` to opt in to Turbopack for local diagnosis, or `DEER_FLOW_DEV_BUNDLER=webpack` to select Webpack explicitly. Reconsider the default after the stable fix is verified on macOS arm64 and Linux.
- Environment validation can be skipped with `SKIP_ENV_VALIDATION=1` (useful for Docker)
- Backend API URLs are optional; nginx proxy is used by default in development

## License

MIT License. See [LICENSE](../LICENSE) for details.

### Matrix Law document workspace

The lawyer chat keeps a permanent icon rail, a collapsible project tree, the conversation in the center and function tabs on the right. The rail retains the sidebar toggle, search, settings and authenticated account menu when the tree is hidden. The tree has a dedicated New conversation action: it binds to the current matter or asks for a project first. Long conversation lists show five entries initially, retaining the current conversation, with Show more to reveal the rest. The header bell opens the current matter's existing reminders and schedule; it does not claim to be a global unread inbox.

Open project materials in the right workspace to view originals or proofread existing OCR, and browse saved versions through protected APIs. Both desktop dividers can be dragged; the left divider also accepts arrow keys and double-click reset. Width preferences are remembered. Expanding, switching tabs and returning retain the mounted editor and conversation. Mobile uses the same workspace as a fullscreen view. Attachments and opened project materials are labeled separately; neither label certifies model usage or lawyer review. This UI update does not complete W5 OCR acceptance.

The overview also has a matter-scoped speech panel. When the tenant server enables its local ASR worker, lawyers can upload allowlisted audio/video evidence, wait for malware scanning, run transcription locally, seek to transcript segments, and save append-only lawyer review versions. Machine text remains labeled unreviewed and is not a legal citation. The local speech worker and model are disabled until operators admit their dependencies and verify their licenses and quality.
