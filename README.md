# dsh-edu

当前项目是深度适配个人使用，项目只是给大家提供思路和借鉴，尽量不要直接照搬。

在 DeepSeek Harness 输入框下方显示当前模型对应的额度或余额：

- **ChatGPT Codex**：5 小时 / 7 天限额
- **Grok / SuperGrok**：周限额
- **DeepSeek 官方 API**：账户余额
- **智谱 GLM（bigmodel / z.ai）**：现金余额（悬停可看生效的 Token 资源包）

面向 **官方桌面**（`connection.fetch`）。不另存 token，只在 Host 侧通过 DSH `credentials` 读取本机已有凭据；浏览器只请求 `/api/dsh-edu`，响应不含密钥。不支持的提供方不显示、也不请求其官方额度接口。

## 查询与显示

- 会话模型优先使用官方 `modelSelection.next` 投影，再使用历史请求的模型；已存在且尚无选择或历史请求的新会话使用默认模型。会话不存在、投影服务不可用或读取失败时明确报错，不改查无关的默认账号。客户端通过会话槽位的 `useProjection` 立即响应模型切换，清除旧读数。
- 成功结果按提供方和实际凭据缓存 **3 分钟**，每次请求先核对当前凭据。换号、退出、续期、修改凭据或路由配置会使旧结果失效；旧请求晚返回不会恢复旧读数。同账号并发请求共用一次查询。
- 智谱现金与资源包各自缓存成功结果。资源包查询失败时保留已确认的现金，内联显示“资源包查询失败”，悬停可看原因；约 **30 秒**后重试失败分项，不重复请求缓存有效的现金。`packages: null` 表示查询失败，`packages: []` 才表示已确认无生效资源包。API 用 `warning`、`state: "partial_retry"` 和 `retryAfterMs` 表达这类部分失败。
- 客户端采用完成后再调度的串行轮询，普通前台轮询间隔 **2 秒**，不支持的提供方为 **30 秒**；模型投影变化立即查询。后台暂停，恢复前台立即刷新；部分失败按 Host 返回的退避时间重试。单次浏览器请求 **20 秒**超时，超时、HTTP 或解析错误均清除旧数字并显示错误，不永久丢弃慢响应。
- 未知用量不当成 `0%`，非法数值不当成零。解析器拒绝布尔值、数组、对象、非法百分比和越界日期；保留真实的负现金余额。路由匹配只接受明确支持的自有键。

不读取 `~/.grok/auth.json` / `~/.codex/auth.json`。

## 安装

复制到 `$DSH_HOME/plugins/dsh-edu`（默认 `$DSH_HOME` 为 `~/.dsh`），在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 写入：

```yaml
- insert:
    - id: dsh-edu
      name: ../../plugins/dsh-edu/lib/index.js
```

**完全退出 DeepSeek Harness（macOS：⌘Q）再打开。** 仅刷新页面不会完整重载 Host 和 Client 插件。

凭据沿用当前模型路由，通过官方 `llm` 元数据和 `settings.describe()` 读取配置：

- GPT/Grok 使用 `llm-pi-ai/openai-codex` / `llm-pi-ai/xai` 的 OAuth 凭据。路由显式指定 API Key 时不展示其他 OAuth 账号的限额。
- DeepSeek 官方 API 使用路由的 `apiKeyEnv`，默认 `DEEPSEEK_API_KEY`。
- pi-ai 的 DeepSeek、智谱路由依次使用显式 `apiKeyEnv`、该路由存储的 API Key、原生凭据引用（`DEEPSEEK_API_KEY`、`ZAI_CODING_CN_API_KEY` / `ZAI_API_KEY`）。显式引用缺失时显示错误，禁止改用其他账号的默认 Key。
- 自定义服务地址、覆盖认证请求头或无法确认凭据的旧路由会显示归属错误，不拿官方账号余额冒充该路由余额。

官方 `deepseek-account` 登录账户余额继续由官方界面提供，插件的 DeepSeek 余额用于 API Key 路由。

## 开发与验证

```bash
for file in lib/*.js; do node --check "$file"; done
node --test
# 或 npm test
```

测试使用模拟凭据和官方接口响应，不读取真实凭据、不调用真实额度接口。覆盖模型投影优先级、新会话默认模型、独立缓存与短退避、账号切换和晚响应保护、串行轮询与后台暂停、部分失败显示及严格解析。

0.1.2 的修复针对 DSH 0.2.1-alpha.1 的公开投影和会话槽位 API。隔离浏览器夹具已验证实际客户端的慢响应展示、模型切换、资源包警告、未知用量错误及轮询生命周期；这不等同于已重启桌面或真实账号端到端验收。桌面更新后仍需完全退出再打开，并在自己的账号上确认显示。
