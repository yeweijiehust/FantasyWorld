# FantasyWorld Post-v1 Roadmap

## Summary

Post-v1 的目标是把当前“可玩原型 + mock 推演 + 真实模型配置探测”升级为真正由 LLM 驱动的世界推演游戏。

旧 Step 1-14 已完成并部署；下面从 Post-v1 Step 1 重新编号。每个 Step 默认独立 PR，完成后运行相关本地门禁和 GitHub
Actions。

截至 2026-06-19，Post-v1 Step 1-9 已进入 PR #21。目标是让创建世界和推进回合具备真实 OpenAI-compatible
LLM 结构化生成路径。同时保留 mock
fallback 以支持本地测试和 CI，并让 LLM 失败进入可恢复 job，且支持存档级模型覆盖、用量/成本可见性、生产同进程后台 worker 和分支时间线。

## Roadmap

### Post-v1 Step 1：修正文档口径

状态：已在 PR #21 完成。

- 明确 v1 是可玩原型，不是完整真实 LLM 推演版本。
- 将真实 LLM 世界生成、真实回合推演、成本计算、后台 worker、多用户等能力归入 Post-v1。
- 验收：计划文档不会让读者误解为真实 LLM 已经驱动游戏。

### Post-v1 Step 2：LLM 结构化生成接口

状态：已在 PR #21 完成。

- 扩展 LLM service，使其不只支持连接探测，还支持结构化 JSON 生成。
- mock provider 和 OpenAI-compatible provider 使用同一契约。
- LLM 输出必须经过 TypeBox schema 校验；失败返回稳定错误。
- 验收：mock provider 单测稳定，真实 provider 可通过 OpenAI-compatible JSON mode 调用，CI 不需要真实 key。

### Post-v1 Step 3：真实 LLM 创建世界

状态：已在 PR #21 完成，待合并。

- 创建世界草稿由 LLM 生成结构化 save draft。
- 输入包含模板、世界设定、角色种子、语言、内容边界、随机性和风格。
- 无 API key 时继续使用 mock/模板路径。
- 验收：配置真实模型后，创建草稿来自真实 LLM；草稿接受前不写入正式存档。

### Post-v1 Step 4：真实 LLM 回合推演

状态：已在 PR #21 后续提交完成，待合并。

- 推进回合时调用 LLM 生成世界裁判、角色意图、行动、对话、状态变化、记忆更新和关系变化。
- 输入包含世界摘要、地点、角色目标、秘密、私有记忆、关系和 GM 指令。
- 验收：真实模型能推进回合；GM 指令影响结果；非法输出不污染正式世界。

### Post-v1 Step 5：LLM 失败修复闭环

状态：已在 PR #21 后续提交完成，待合并。

- schema 失败、坏 JSON、超时、provider 错误都进入可恢复 job 状态。
- 保存失败阶段、错误原因和必要的原始输出摘要。
- UI 支持失败、重试、取消和刷新恢复。
- 验收：失败 job 不写正式 save；重试成功后可继续接受。

### Post-v1 Step 6：存档级模型配置持久化

状态：已在 PR #21 后续提交完成，待合并。

- 每个存档支持覆盖全局模型配置。
- API key 仍加密保存，导出仍不包含密钥。
- 优先级：存档覆盖 > 全局默认 > mock fallback。
- 验收：不同存档可使用不同模型；删除覆盖后回到全局默认。

### Post-v1 Step 7：真实成本与用量可见性

状态：已在 PR #21 后续提交完成，待合并。

- 记录每次 LLM call 的 provider、model、tokens、latency、status。
- UI 展示每回合 input/output tokens 和估算成本。
- 用户可手动配置模型单价；不强依赖官方价格表自动同步。
- 验收：真实调用显示 usage；mock 模式显示 estimated usage。

### Post-v1 Step 8：后台任务队列

状态：已在 PR #21 后续提交完成，待合并。

- job 创建后进入 `queued`，worker 领取后进入 `running`。
- 首版 Render 免费层使用同进程 worker，未来可拆独立 worker。
- 同一存档只允许一个 active turn job。
- 验收：刷新页面能恢复 job 状态；worker 重启后可恢复或标记失败。

### Post-v1 Step 9：分支时间线

状态：已在 PR #21 后续提交完成，待合并。

- Turn 从线性历史升级为 tree/graph。
- Save 保存当前 head turn；回滚切换 head。
- 从旧 turn 继续推进会创建新分支。
- 验收：回滚后继续推进不丢失旧未来线；导入导出保留分支结构。

### Post-v1 Step 10：多用户与权限

状态：已在 PR #21 后续提交完成，待合并。

- 引入用户账号、save ownership 和 session-user 绑定。
- 将现有单管理员数据迁移到 owner user。
- 登录页支持输入 username；当前仍使用部署级共享管理员密码作为过渡认证，不做公开注册。
- 验收：用户只能看到自己的存档；旧存档迁移后仍可用。

### Post-v1 Step 11：协作与多人玩法

状态：已在 PR #21 后续提交完成，待合并。

- 存档支持邀请协作者。
- 权限包含 GM、Viewer、Player。
- Player 可绑定角色，GM 可审核玩家输入。
- 审核通过的 Player 输入会进入下一次回合推演输入，并在使用后标记为 used。
- 验收：GM 能邀请用户；Player 只能访问授权范围；GM 仍可查看全局状态。

### Post-v1 Step 12：备份、恢复与密钥轮换

状态：已在 PR #21 后续提交完成，待合并。

- 增加应用内备份/恢复操作手册。
- 实现 `ENCRYPTION_KEY` 轮换工具。
- 增加解密失败检测和恢复提示。
- 验收：轮换 key 后旧 API key 仍可解密；恢复演练步骤可执行。

### Post-v1 Step 13：真实 LLM smoke test 与监控

- 增加手动触发 live smoke test。
- 健康页区分 app health 和 model health。
- 记录最近 LLM 错误率和平均延迟，不暴露敏感 prompt 或密钥。
- 验收：有真实 key 时 smoke test 可运行；无 key 时明确跳过。

### Post-v1 Step 14：v2 验收

- 配置真实模型后，创建世界和推进回合都会真实调用 LLM。
- mock 模式仍可测试和试玩。
- 失败、重试、取消、恢复闭环完整。
- 成本可见，存档级模型覆盖可用。
- GitHub Actions 全绿，用户手动完成 Render 部署和生产 smoke test。

## Current Priority

当前优先实现 Post-v1 Step 13：真实 LLM smoke test 与监控。
