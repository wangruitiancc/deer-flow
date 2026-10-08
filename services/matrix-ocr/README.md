# Matrix Law Private OCR Service

`matrix-ocr` 是 MatrixFlow Law 的私有 OCR 执行服务，实现扩展侧固定的
`matrix-ocr-http-v1` 协议。服务使用 PP-OCRv6 small 官方 ONNX 检测、方向分类和识别模型，
默认产生按阅读顺序排列的文本块；请求表格或公式时，通过私网调用独立 PP-StructureV3 sidecar，
严格校验表格单元格/rowspan/colspan 和公式 LaTeX，并以同一协议返回结构块。sidecar 未配置或不可用
时结构请求 fail closed，不用普通文本伪装结构结果。

## 安全边界

- 默认只监听 `127.0.0.1`；容器内监听 `0.0.0.0`，但 Compose 不应发布宿主机端口。
- 两个 HTTP 路由都要求 Bearer Token，Token 至少 24 个字符且只从环境变量读取。
- 上传必须声明精确大小和 SHA-256，服务边收边校验并写入权限为 `0600` 的临时文件。
- 原始证据和渲染页只存在于单次任务临时目录，处理结束后删除。
- 日志不记录 Token、用户文件名、证据正文或 OCR 正文。
- ONNX Runtime 遥测在加载原生运行库前被强制关闭，不能通过部署环境重新开启。
- 处理并发、排队长度、上传大小、页数和处理时限均有上限。
- PNG/JPEG/单页与多页 TIFF、PDF 共用页数上限；当初始方向无文本或多数文本行倒置时，受控尝试
  90/180/270 度并返回归一化旋转修正。
- 客户端中止会取消正在进行的页面推理，释放有界队列容量，并以不含正文的 `499 REQUEST_ABORTED`
  日志收口；不会继续生成可提交的结果。
- 服务响应显式禁止缓存。生产候选环境应仅允许 Gateway 所在私网访问。

## 本地验证

```bash
npm ci
npm run models:download
npm run models:verify
npm run check
npm test
npm run build
npm run smoke:model
npm run smoke:structure
npm run quality:synthetic
```

模型权重由 `resources/models.manifest.json` 锁定 URL、大小与 SHA-256，下载到被 Git 忽略的
`resources/models/`。构建镜像时会重新下载并校验，不把开发机上的模型文件带进构建上下文。

启动服务：

```bash
MATRIX_OCR_HTTP_TOKEN="replace-with-a-random-private-token" npm start
```

使用 DeerFlow 后端已经安装好的扩展环境验证完整适配器链路：

```bash
MATRIX_OCR_HTTP_TOKEN="replace-with-the-same-token" \
  /path/to/deer-flow/backend/.venv/bin/python \
  scripts/extension-adapter-smoke.py
```

扩展单独执行 `uv run` 时无法从公共索引解析 checkout 内的
`deerflow-extension-api`；集成验证必须使用 DeerFlow backend workspace/虚拟环境。

## 质量度量与合成回归门

`src/quality.ts` 对按物理页组织的 OCR 结果计算 CER、关键字段召回率、引用锚点召回率、表格结构
召回率、公式结构召回率、平均/缺失/低置信度 block、低置信度比例，以及 `0/O`、`1/I/l`、
`2/Z`、`5/S`、`8/B` 易混淆计数。金标要求结构而结果只有普通文本时必须 fail closed。
缺页、缺失置信度或任一策略阈值失败都会进入 `gate_failures`；`review_reasons` 单独表达需要
人工检查的原因。

版本化清单位于 `quality/gold/synthetic-v1/manifest.json`。当前三个程序生成的清晰合成样例由真实
PP-OCRv6 small 推理，结果均为 CER 0、关键字段召回率 1.0、
引用锚点召回率 1.0。脚本输出固定声明 `synthetic-regression-only` 与
`production_candidate=false`；当前版本化质量清单中的表格/公式样例总数仍为 0。另有程序生成的
4×3 表格/公式结构烟测，但它同样只用于防回归，不能替代经过授权、
脱敏、双人标注的真实中文法律金标集，也不能据此宣称生产精度或结构识别达标。

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `MATRIX_OCR_HTTP_TOKEN` | 无 | 必填，共享私网 Bearer Token，至少 24 字符 |
| `MATRIX_OCR_BIND_HOST` | `127.0.0.1` | 监听地址 |
| `MATRIX_OCR_PORT` | `8090` | 监听端口 |
| `MATRIX_OCR_MAX_UPLOAD_BYTES` | `52428800` | 单文件上限 |
| `MATRIX_OCR_MAX_PAGES` | `100` | 单文件页数上限 |
| `MATRIX_OCR_DPI` | `200` | PDF 栅格化 DPI |
| `MATRIX_OCR_INTRA_OP_THREADS` | `1` | 单个 ONNX 会话线程数 |
| `MATRIX_OCR_MAX_CONCURRENCY` | `1` | 同时推理任务数 |
| `MATRIX_OCR_MAX_QUEUE` | `8` | 等待队列上限 |
| `MATRIX_OCR_PROCESS_TIMEOUT_SECONDS` | `300` | 单请求总时限 |
| `MATRIX_OCR_RESOURCES_ROOT` | `resources/` | 模型清单和模型目录 |
| `MATRIX_OCR_TEMP_ROOT` | 系统临时目录 | 单次任务临时目录父路径 |
| `MATRIX_STRUCTURE_ENDPOINT` | 无 | PP-Structure sidecar 私网 origin；配置后才开放结构请求 |
| `MATRIX_STRUCTURE_HTTP_TOKEN` | 无 | sidecar Bearer Token，至少 24 字符 |
| `MATRIX_STRUCTURE_REQUEST_TIMEOUT_SECONDS` | `180` | 单页结构请求总时限 |
| `MATRIX_STRUCTURE_MAX_RESPONSE_BYTES` | `10485760` | sidecar 响应大小上限 |
| `MATRIX_STRUCTURE_MAX_UPLOAD_BYTES` | `26214400` | 发送给 sidecar 的单页 PNG 上限 |

## 当前限制

- OCR 输出质量仍需使用法律文书金标集验收；现有合成质量门只覆盖清晰程序生成样例，历史复杂烟测
  曾观察到数字 `0` 被识别为字母 `O`，因此仍保留易混淆统计与人工复核门。
- 单页合成 4×3 表格和公式已完成实际 PP-Structure 模型、离线容器、Gateway、PostgreSQL 与浏览器
  闭环；真实中文法律表格、跨页表格和结构纠错尚未验收。
- 当前服务是单进程有界队列，不承担跨节点任务调度；租约、重试和 fencing 由法律扩展 worker 负责。
- 旋转扫描、多页 TIFF、小型多页 PDF 与合成单页表格/公式已完成真实模型烟测；进入生产前仍需完成
  中文法律材料金标集、大 PDF、跨页/复杂表格、并发、内存和容器级故障恢复测试。
