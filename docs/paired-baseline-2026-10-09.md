# Matrix Law 配套源码基线：2026-10-09

本次由用户授权保存两个仓库并提交到用户自己的 GitHub 仓库。DeerFlow 推送目标为 `wangruitiancc/deer-flow`，产品分支为 `matrix-law`；`bytedance/deer-flow` 仅作为读取上游，禁止向其推送。

配套的法律扩展权威仓库为 `wangruitiancc/matrix-law-deerflow`。两仓使用同一个 `baseline-2026-10-09` 标签；不要把不同日期/分支的宿主与法律扩展混用。公开扩展接口版本及宿主精确依赖统一为 0.2.12。

验证：后端完整离线检查 14,091 passed / 105 skipped / 2 deselected；阻塞 I/O 检查 98 passed；前端 1,766 passed，类型/ESLint 检查与 Next.js 构建通过。外部/live 条件跳过不构成真实供应商、生产 PKI、Linux/KVM Guest 或法律质量验收。

法律扩展是独立权威源码。`backend/extensions/sources/matrix-law-extension` 是安装/构建副本，不进入本仓 Git；从同一基线的法律仓库准备副本后，使用本仓锁文件同步依赖：

```bash
python3 /path/to/matrix-law-deerflow/scripts/ci/prepare-paired-extension-source.py --deer-flow-root /path/to/deer-flow
cd /path/to/deer-flow/backend
uv sync --locked --all-packages
make test TEST_PYTHONPATH=.:/path/to/matrix-law-deerflow/extensions/matrix-law-extension
make test-blocking-io TEST_PYTHONPATH=.:/path/to/matrix-law-deerflow/extensions/matrix-law-extension
```

准备工具仅复制包源码，保留已有副本到本机临时恢复目录，不复制配置、凭证、数据库或原始案件。两服务器运行状态没有因本次提交改变。完整修复与验证记录保存在配套法律仓库。
