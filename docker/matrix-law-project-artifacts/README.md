# 项目成果 P1 独立全栈验证

会话 65：前端更新为 `matrix-law-frontend:conversation-delete-v1`（`dac2ad823696f60be32bc62fcb3672b4cbbc27a74c86acf91e9c850dfa12d751`）。项目树会话悬停菜单复用既有 law detach 与 DeerFlow thread delete：本人空闲会话删除、他人会话仅移出、busy 禁止删除，项目成果版本保留；membership 和本人 thread 状态成功读取前不显示菜单。仅 no-deps 重建 frontend；真实 1280/390 项目成果链均验证 detach 200、thread DELETE 200/后续 404。前一版以 `conversation-delete-v1-pre-gate` 保留，更早镜像亦未删除。

会话 64：本隔离候选的原生 thread 附件为每批 10 个、单文件 2 GiB、合计 4 GiB；精确 upload location 使用 4097 MiB multipart 预算、关闭代理请求缓冲并设置 3600 秒超时。Gateway multipart 临时文件落 `p1-home:/runtime/.upload-spool`（0700），不占 128 MiB `/tmp`。256 MiB/2 GiB 合成上传与授权逐字节回读通过，匿名读取拒绝；真实页面桌面/手机均显示 2 GiB/4 GiB。该配置不等于证据扫描/OCR、断点续传或多租户容量验收，`auto_convert_documents=false`。

会话 61：独立 nginx.conf 在共享配置基础上仅增加法律 evidence/project-artifacts 提交路径的 51 MiB 请求预算（50 MiB 文件 + 1 MiB multipart）；其余路由不变。
共享 docker/nginx/nginx.conf 与 2030 未改。权威生成逻辑为相邻 Matrix Law 仓 scripts/render_candidate_nginx.py，stdout 生成；tests/test_candidate_nginx.py 核对完整派生文件与 compose 挂载，宿主基础配置变动后必须重审/重生成，不手工漂移。
真实 500 条首次验收漏点原生“加载完整文件”；补步骤后暴露项目保存被旧 nginx 默认 1 MiB 拒绝（413）。未缩小样例或放松完整字节校验。
新私有基线 candidate2035-predeploy-20260906T120814Z 与新库/新卷恢复核验通过；仅 no-deps/pull-never 替换 nginx，51 表内容、其余服务容器、旧 migrate、共享配置和 2030 均不变。2 MiB 未认证法律提交到达鉴权并拒绝，普通 auth 仍 413，法律请求声明 51 MiB + 1 字节在读取正文前 413。
精确导入守卫现在同时要求该只读配置挂载与 SHA 5127d12474ca3030c2d77f4779825de9e1c0a2347c9777075133a51b16037ebb。500 条真实模型双文件保存/历史下载 1 passed（19.6 秒），最终真实服务联合 10 passed（1.5 分钟），占位已恢复。完整证据见 Matrix Law 部署记录，下方为历史。

会话 59 历史配对为 GW/FE `legal-authorities-import-v1`：
GW b3135e901807bd7fc6237d39511b09b2da8f28004b47693e5ddee9f4b96db3e0；FE 9fcdf4c0b5eb9fbff8a0e69fe25d40e2e5047e9aae565d315fb91622ee7d6df0。
原生写入有界设为 16777216 字节，也影响普通 write_file，法律模板仍限 64 KiB。新备份/恢复与部署前后 51 表不变核验通过，旧 migrate 未启动。
会话 60 真实服务联合 10 项与严格 MiniMax 小样本普通 Send/两份原字节交付/依据扫描保存历史 1 项通过；已恢复占位。大文件真实链路、报告项目历史与官方核验待续，55 失败及下方配对保留为历史记录。

会话 54 当前配对：GW `matrix-law-gateway:legal-authorities-v1`
（`2d48239e0d7343457f926595d6800b92a46297fa0a94e3319eb2b65c1563d90c`），
FE `matrix-law-frontend:legal-authorities-v1-ready`
（`56c78f70fed2d419ab0d830d9a45499e165d1b3735571c762304c92a1acdeca2`）；法律 0016、宿主 0019 不变。
旧法条导入和法律依据整理已部署；真实后端桌面/手机专项 2 项、联合 10 项通过，明确合成播种不冒充模型生成。
首轮恢复入口用 compose start nginx 误启旧 migrate 容器并失败，逐表比对确认 51 表内容未变。
更新既有栈须先校验归属/镜像/空闲和备份，只替换明确组件（no-deps），直接按已校验 nginx ID 恢复入口，
不要用 compose start 遍历陈旧迁移依赖。新栈初始化与既有栈更新分开。旧失败 migrate 容器保留。
完整恢复与故障记录见兄弟项目 docs/design/candidate2035-legal-authorities-deployment.md。
会话 55 新增兄弟项目 `--execute-model --with-authorities-ui`，精确配对/归属/loopback/空闲/两个版本守卫后，
临时用已有模型做合成普通发送和完整文件交付验收，finally 恢复占位。旧模板模式仍应拒绝新配对；不得绕过守卫直接启用模型。
以下为历史阶段说明。

会话 55 首轮真实模型运行 success，但依据输出缺少尾换行，完整字节验收失败，未进入项目保存；
已恢复原配置挂载/占位模型、Gateway healthy、空闲任务。待通过宿主原生字节传输和法律域确定性交付修复，不能放宽比较。

此配置只用于本机合成材料联调，不使用 2030 的数据、网络、模型凭据或容器。

2030 主入口现已通过兄弟项目 `scripts/upgrade_local_p1.py` 升级到独立的
`matrix-law-local-p1` 持久栈；原数据恢复、法律 0015、低权限 RLS、真实存储与
候选 2036 的桌面/手机浏览器验证已通过。原模型配置保持，真实模型的合成短文生成、
扫描保存与下载一致性已验证。旧 Gateway 暂停、旧数据库保留；不能直接切回旧栈而丢失新写入。
本目录仍是独立 2035 测试栈，不要用它覆盖主入口的私有配置或数据。签名密钥轮换后需重新登录。
入口为 `http://127.0.0.1:2035`；法律 API 使用独立低权限数据库角色，文件真实进入 MinIO 并由 ClamAV 扫描。
这是 shadow 测试环境，不是生产候选：没有可调用模型、TLS/KMS、真实法律材料、灾备或容量验收。

```bash
# 仅新建的合成栈初始化；既有栈的组件升级遵循上述备份和 no-deps 流程。
docker compose -f docker/docker-compose.matrix-law-project-artifacts.yaml up -d nginx
backend/.venv/bin/python docker/matrix-law-project-artifacts/verify_http.py
python3 scripts/pnpm.py exec playwright test --config playwright.matrix-law-project-artifacts.config.ts
```

会话 38：当前独立环境已更新为 `matrix-law-gateway:custom-templates-v1` 与
`matrix-law-frontend:custom-templates-v1`，法律数据库为 0016_custom_templates，宿主仍为 0019。
Gateway SHA `fd9f3f67e59b58da8f951fc0aaf08425e1dd07b64eab60e46368a8f44d8c37bc`，
Frontend SHA `6103da1c9d7158db319654acec02f2fc1efc3491432012e85e556537ba7f2a56`。
升级前完成兄弟项目精确 candidate2035 冻结与新库/新卷恢复演练，再迁移并下发新表角色权限。
真实模板 HTTP/ClamAV 验证已通过；自定义模板发送后的模型闭环尚未验收，2030 保持旧版本。
兄弟项目 `scripts/verify_custom_templates_http.py --synthetic-2035` 创建合成数据并短停本扫描器测试故障拒绝，finally 恢复。
私有基线与恢复资源不提交/不同步。已有新写入后不能直接恢复旧 dump，详见兄弟项目候选模板部署记录。

会话 39：兄弟项目 `--execute-model --with-custom-template-ui` 在同一配套镜像上完成一次
桌面合成历史模板的真实普通 Send/MiniMax/原生精确副本/右侧编辑/模板追加和另存/项目扫描保存。
原两版与所选 BOM/CRLF 字节保持，run a52c1384-61b2-4d12-a503-f693b1b92466；最终 1 passed（22.4 秒）。
两轮均恢复占位，未改 2030、镜像或迁移版本。填变量、管理和旧模板导入仍待实现，不是生产/法律质量验收。

以下为会话 31 的历史版本记录，旧镜像保留：`matrix-law-gateway:legal-template-picker` 与 `matrix-law-frontend:legal-template-picker-direct`。
构建分别使用仓库根目录 `docker build --build-arg UV_IMAGE=docker.io/astral/uv:0.11.1 -f backend/Dockerfile -t matrix-law-gateway:legal-template-picker .`
及 `docker build -f frontend/Dockerfile --target prod -t matrix-law-frontend:legal-template-picker-direct .`。
当前 Gateway SHA `76cd43b43497229d4b8dad9622610f6e6c83b0424de3109038f05e8cd8ce8181`，
Frontend SHA `8f85db575d2700e210ec69a3b3463887aef46ba4c106f4865cb4617260661be2`。
会话 31：右侧“用模板起草”读取已鉴权部署目录，确认前重查项目权限，只放入普通会话草稿。
法律中间件直接提供确定性工具，不依赖产品刻意关闭的 /api/skills，也不开放通用控制面。
本轮未启用真实模型；2030 和所有旧镜像保留。完整 UI 验收结论见兄弟项目本日 Dev Log。
最终配套版本通过 6 项真实 Chromium 回归：桌面/手机的图谱、笔记历史和模板准备；
模板不会覆盖已有输入或自动创建 run。没有网络替身，图谱/笔记初始文件仍是合成播种。
会话 32：兄弟项目 `--execute-model --with-template-ui` 使用独立浏览器配置，实际选择模板、普通
Send、MiniMax、原生右侧预览、扫描保存/下载完整通过。只验证一种合成合同审查模板，不代表法律质量。
最终 run fde99406-0cc4-44ff-981d-46f0f3d09d8b；验收后已恢复不可调用占位，四个现有应用镜像不变。
会话 30：新增法律扩展的确定性模板工具，复用宿主沙箱新建/回读及真正的 present_files 调用，
不修改 worker 的完成判定。直接返回 artifacts 状态的中间候选不满足原生交付回执，已弃作验收候选；
新版本必须通过源模板/输出全字节和实际 run.delivery 验证。完整结果见兄弟项目本日 Dev Log。
下文会话 29 为历史反例，不代表当前发布接线；UI 选择与自定义模板仍待完成。
会话 29：新增只读 matrix-law-templates Skill 与六种 Markdown 资源，原生激活、文件交付和项目保存沿用框架。
旧 graph-native-enforcement 镜像保留。首次 legal-templates 候选三个模板通过，但证据清单擅自追加时间，
严格验收拒绝且未保存；日期占位符规则修订后改为本 date 镜像，不放宽正文比对。完整验收使用兄弟项目
`scripts/verify_live_legal_graph.py --execute-model --with-templates`，最终结果见其本日 Dev Log。
模板选择界面、租户自定义模板及法律质量尚未验收，2030 未升级。
date 镜像复测前两项通过，法律意见书 run f5e9cf22-d1f9-4b95-bc7e-ec15f5fdb702
又新增时间字段，严格验收拒绝，未保存该项；最终已恢复占位。不能标记六种全部通过，
也不继续用提示词修补替代确定性模板创建。候选仅用于隔离开发，不升级 2030。
v1 增加可选 `legacy_origin`，严格校验并保留未核验旧来源；前后端配套升级。
映射复用现有 citation 读取、原生文件草稿/保存及项目版本，无新增写 API 或数据库迁移。
Skill 已补齐映射后回读约定，SHA `0f297b9905995961e9098f66dcf1cabe9e5e94a5eec6efae8ec2715ec9ad9e1d`。
兄弟项目 `scripts/verify_live_legal_graph.py --execute-model --with-mapped-source` 是显式 opt-in
的 API 驱动合成模型验收：真实上传、受保护引用、原生文件、结构/来源保留及扫描保存。
仅临时使用原 2030 模型配置，finally 恢复占位；不替代浏览器映射、OCR 精度或法律质量验收。
两轮结果：首轮通过；复跑正确保留数据和识别旧摘录差异，但漏调 law_validate_graph，
验收以 MAPPED_VALIDATION_MISSING 拒绝，未继续保存项目版本。上述是会话 26 的历史结果，两轮已恢复占位。
会话 27 最初观察型拦截原型也失败；该原型镜像 legal-graph-publication-gate 不作为验收版本。
现复用既有 extensions.middlewares 配置，加载 matrix_law_extension.runtime.enforcement:LawEnforcementMiddleware。
配置已在本目录 config.yaml 中显式启用，安装扩展本身不够；回滚旧镜像须同时撤销该类路径。
最终真实模型 run a3379625-e0ca-4b2b-80d1-ac4fc926efde 未单独调用校验工具，
仍经发布门重读文件/核验引用权限，并通过内容 SHA 凭据、旧结构保留和扫描保存验收。
成果 67a1b87d-f988-4cca-9437-19fe629a1e85；下载 SHA a75647ee62bcc86d69767502e11b3a2234761d1d296a612f987b456bfb9b9a65。
已恢复占位模型，2030 未改。该门不是不可变发布快照；文件之后仍可能编辑，项目保存另行校验。
会话 28 新增兄弟项目参数 `--execute-model --with-stop-retry`：两次真实模型参数流停止、
同线程新 run 重试、原生发布校验与扫描保存通过；原运行保持 interrupted，废弃文件没有生成。
最后重试 run 7eda5058-e444-4de5-8771-919624c215ea，成果 cf6be210-9541-49ba-8f32-100906fc60e0。
仅 API 场景，不证明浏览器按钮或在途文件写入回滚。两轮均恢复占位，没有更换镜像或数据库。
初始化会应用宿主/法律迁移并配置 API/worker 角色；以数据库版本表为准，不能仅依赖旧初始化日志的版本字符串。
数据库、对象、签名库和 runtime home 使用本项目独立的命名卷。

验证脚本会注册合成用户、创建独立租户/咨询、绑定 DeerFlow thread，测试保存、幂等、版本冲突、逐字节下载、
跨租户/伪造路径拒绝、标准 EICAR 测试标记拒绝。还会暂时停止**本配置自己的** ClamAV，验证保存/下载 503，
并在 finally 中恢复该服务。脚本不使用真实模型，不证明原始 thread 文件出处已经独立核验，也不等于浏览器点击验收。
重复运行会保留各轮合成数据，便于审计；不要把它指向客户数据环境。

浏览器测试另行覆盖桌面/手机真实登录、原生文件保存、刷新追加版本、跨会话历史预览、受保护下载与来源返回，
不拦截 API。仅初始会话和笔记通过公开状态接口/测试容器文件系统播种，明确不代表模型生成。
为使原生历史物化能够构建 graph，配置含不可调用的占位模型（loopback port 1），测试不能执行它。
前端 SSR 必须设置 `DEER_FLOW_INTERNAL_GATEWAY_BASE_URL=http://gateway:8001`，不能在容器里使用 localhost。
测试不保存鉴权 trace；截图仅含合成材料。历史接口须保留 checkpoint 的 `artifacts`（含空列表），否则刷新会丢目录。

2026-09-06 图谱 G1–G3 已更新到本独立环境，2030 未更新：

- Gateway `68f8a47473a3f16a997ee1cd7c6e28837ff7e25ea1e646d8c6994e1773d974bf`；
- Frontend `7239a9bf30b8e0646d3c8dbfa9c9013b30a14f01bd713ef6bf6b313dfc842bbf`；
- 只重建 gateway/frontend 并重载本栈 nginx，数据库仍是 0015，API/worker 无 superuser/BYPASSRLS。
- `matrix-law-legal-graph-real.spec.ts` 只允许 2035，桌面/手机均通过真实文件编辑保存、刷新、图谱版本追加、旧版只读、SHA 冲突、伪造引用拒绝、成员加入/移除后的内容授权和审计断言。与原笔记测试合跑 4 项通过。
- HTTP 脚本另通过真实扫描、EICAR 拒绝、扫描离线保存/下载失败关闭；finally 恢复扫描服务。
- 初始图谱为共同契约样例，来源是未核验摘录；本轮不证明真实 OCR 引用正文的图谱交互、法律事实或模型挖掘质量。
- 原 P1 镜像标签/内容保留，未删除数据库、对象或 runtime 卷。主入口是否升级另行验证，不能用此公开合成配置替换主入口私有配置。

同日追加来源验收：前端更新为 `legal-graph-sources`，SHA
`59ab1a5705bf1a3137a0054be5202f75381525f13a93295abe42d3edf49f5f6e`；只重建 frontend 并重载 nginx，Gateway/数据库不变。
上述图谱测试现使用真实 PDF 上传/扫描/存储与 citation API，只有标准化 OCR 结果通过
`seed_graph_ocr.py` 合成播种。脚本检查合成环境签名标识和新建 graph 租户所有者，
只操作该证据自己的任务；rerun 使用真实 repository 血缘，不把不同请求指纹当作重跑。
桌面/手机均通过引用原文、同血缘重跑不改写旧引用、材料归档后历史图谱仍能授权读取、
第二用户重新读取时撤权 404/清空正文和 citation read allowed/denied 审计。
与笔记合跑 4 项通过；图谱专项 66 项通过。此结果不代表 OCR 引擎识别准确率或模型图谱挖掘。
撤权语义是每次读重新鉴权，不宣称实时推送或能收回已经看见/复制的内容。

同日 G4 原生加载验收：Gateway `legal-graph-g4`，SHA
`fcbf6c361bc52337d264564452cca7c52118438a32eaacdd9c0675c617b3841e`。
镜像仅包含经审阅的 `matrix-law-graph` Skill，不打包其他公开/用户 Skill；通过原生 loader 和 projection 使用。
测试配置增加原生 read_file/write_file/str_replace，不开放 bash；占位模型仍不可调用。
七个法律工具通过扩展原生中间件注册；Skill 激活与工具策略相关 69 项通过。
对 HTTP 脚本新建的空咨询线程，可执行以下探针（替换 UUID；只允许本合成环境）：

```bash
docker exec -i matrix-law-project-artifacts-gateway-1 /app/backend/.venv/bin/python - THREAD_UUID < docker/matrix-law-project-artifacts/probe_graph_tools.py
```

探针使用真实 `matrix_law_api` 低权限 RLS 连接、真实准入与事务，原生 Skill 激活后由 ToolNode
调用材料/引用目录并成功返回。模型为脚本替身，不是完整 Gateway 生命周期或真实模型挖掘验收。
标准 HTTP 存储/扫描/权限回归通过。此次仅替换 2035 Gateway，不更新数据库版本或 2030。
若 GHCR 拉取 uv 元数据失败，可加 `--build-arg UV_IMAGE=docker.io/astral/uv:0.11.1` 使用同版本官方镜像。

同日真实模型反馈修正：Gateway 更新为 `legal-graph-g4-feedback`，SHA
`88d9ab1d976fb6875a50261629b789d55acd306a07620aea3602709aef38d8fb`。
结构校验返回最多 12 个安全字段提示，不带输入值/未知字段名；法律工具业务失败标成原生 error。
Skill 澄清 category/angle 枚举和每次改写前重新读取的规则，审阅零警告。
兄弟项目 `scripts/verify_live_legal_graph.py --execute-model` 会临时借用既有 MiniMax 模型配置，
只在本合成环境跑任务；私有配置留在忽略的 .baseline，finally 恢复本文件的占位模型，2030 不变。
实测 run `3d0742e0-710b-422b-8999-e2d1e4b4dec0`：4 节点/6 边，原生查询/校验/文件/展示工具执行，
真实扫描保存和下载字节一致；agent-browser 确认右侧画布/月份时间线。口述来源保留 unverified。
早期工具错误混入最终气泡的问题，已在 `legal-graph-history` 前端修复。
此结果不是 OCR 材料引用挖掘、法律质量、生产或完整 G4 验收；默认配置仍不能调用模型。

后续结构读取镜像 `legal-graph-g4-structure`，SHA
`52f24d7461adbb67714aea0a4b6c4b709200c35b32118982eab977ca91a8a81e`。
`scripts/verify_live_legal_graph.py --execute-model --with-evidence`（兄弟项目）使用真实上传/扫描/存储，
仅播种标记清楚的 OCR 文本/表格；模型自行读取、创建 citation、生成原生成果并扫描保存。
首轮 5 节点/7 边，存储与授权通过，但人工核对发现 2 条引文在单词中间截断。
验证器现已增加 fixture 引文切片/边界检查；对原结果只读重验为 1 条通过、2 条失败，不能称为引用质量通过。
仍需修复模型偏移定位和重试策略，再完成 G4；本轮 4 项真实前端回归通过。主入口 2030 未升级。

会话 21：Gateway `legal-graph-g4-exact`（SHA `8b677467e89f40397b0ad6b57036c5cd04dde1e83b5a7916b87922d3471f7bc4`）
提供精确选文定位，保留旧偏移/幂等协议，歧义、过期 SHA 和创建竞态拒绝或回滚。
真实模型再次使用同类合成 OCR 表格，run `838f7d59-c920-4709-9eb4-8707e8ad2765` 生成 5 节点/5 边，
增强的引文切片/单词边界与实际 exact_quote 来源验证通过；成果 SHA
`3e8c3dd1d2888f036f19f6165f98aebf78c490e89bcceebcab0d266c0fc459f5`，扫描保存/下载一致。
Frontend `legal-graph-scroll`（SHA `93509c141dc0a7128f330330ec2402d0c5c1341df0bf6916445e973316edc2b4`）
修复矮窗口 SVG 溢出，真实回归新增 1280×720/540 和 390×600；4 项真实图谱/笔记回归通过（44.4 秒）。
默认模型已恢复不可调用占位，2030 保持原版本。OCR 精度、法律质量、完整停止/重试与整体 G4 未验收。

会话 22：Frontend 更新为 `legal-graph-import-preview`，SHA
`d690c948ee938920dd221be442580026f1b1a3671fe3818256fe4424efafb19d`。
右侧项目成果新增旧图谱本地转换/原生预览及两个下载文件；服务器不接收旧文件、不伪造 source_artifact_path。
来源映射和真正的项目导入仍待实现。本轮没有调用模型、更新 Gateway 或迁移数据库，2030 不变。

会话 23：前端 `legal-graph-handoff`，SHA
`f843665d14e2fbaa69eec623a58b324e9055661a30140b91f93ee4e10e0c7c64`。
转换图谱及报告可明确放入当前会话的原生附件草稿，不覆盖旧输入、不自动上传/运行/保存；
重新核验权限与附件限额，切换会话不携带待发附件。源映射和模型导入闭环仍待验收，2030 不变。
前端 1333 项及真实桌面/手机回归 4 项通过（54.9 秒），涵盖原生待发附件及 SPA 会话切换隔离；没有点击发送或调用模型。

会话 24：原生浏览器完整导入验收两次通过（41.2 秒、补强后 25.6 秒）。重现命令在兄弟 Matrix Law 项目：
`../deer-flow/backend/.venv/bin/python scripts/verify_live_legal_graph.py --execute-model --with-legacy-ui`。
该命令消耗现有模型配额，仅允许 2035 合成环境，临时挂载模型配置并 finally 恢复占位模型；
私有运行配置/测试诊断位于 `.baseline`，不得提交或同步。浏览器不开 auth trace、不拦截 API。
最终 run `f79308a6-36b9-4369-9878-e502783df604`，成果 `9adcc9aa-5102-4700-8b22-0078676ca129`，
SHA `f2c63abb343bb1177baafad41d898ef871092f73297de4adcc65f4fafe28cfa3`，扫描保存/下载一致，原附件未改写。
3 节点/2 关系与输入语义一致，来源保持 legacy_unmapped；显式证据映射未完成。两次结束均恢复占位，镜像及 2030 不变。

当前 2030 的升级前私有备份由兄弟项目的 `scripts/freeze_local_runtime.py` 生成，
`scripts/verify_local_baseline_restore.py` 校验哈希并恢复到独立测试库。备份文件包含敏感配置，不提交或同步。
PostgreSQL dump 是一致快照；运行文件与源码为在线归档，不应宣称跨资源原子快照或完整服务灾备通过。
