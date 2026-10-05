# dsh-edu

当前项目是深度适配个人使用，项目只是给大家提供思路和借鉴，尽量不要直接照搬。

在 DeepSeek Harness 输入框下方显示当前模型对应的额度或余额：

- **ChatGPT Codex**：5 小时 / 7 天限额
- **Grok / SuperGrok**：周限额
- **DeepSeek 官方 API**：账户余额
- **智谱 GLM（bigmodel / z.ai）**：现金余额（悬停可看生效的 Token 资源包）

面向 **官方桌面**（`connection.fetch`）。不另存 token，只在 Host 侧通过 DSH `credentials` 读取本机已有凭据；浏览器只请求 `/api/dsh-edu`，响应里只有用量/余额数字，不含密钥。当前模型不属于上述提供方时不显示、也不打对应官方接口。

成功结果按提供方和实际凭据缓存 3 分钟，每次请求先核对当前凭据。换号、退出、续期、修改凭据或路由配置会使旧结果失效；旧请求晚返回不会恢复旧读数。同账号并发请求共用一次查询，失败后下一轮重试，前端查询失败会清除旧数字并显示错误。

不读取 `~/.grok/auth.json` / `~/.codex/auth.json`。

## 安装

复制到 `$DSH_HOME/plugins/dsh-edu`（默认 `$DSH_HOME` 为 `~/.dsh`），在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 写入：

```yaml
- insert:
    - id: dsh-edu
      name: ../../plugins/dsh-edu/lib/index.js
```

完全退出 DeepSeek Harness（macOS：⌘Q）再打开。

凭据沿用当前模型路由，通过官方 `llm` 元数据和 `settings.describe()` 读取配置：

- GPT/Grok 使用 `llm-pi-ai/openai-codex` / `llm-pi-ai/xai` 的 OAuth 凭据。路由显式指定 API Key 时不展示其他 OAuth 账号的限额。
- DeepSeek 官方 API 使用路由的 `apiKeyEnv`，默认 `DEEPSEEK_API_KEY`。
- pi-ai 的 DeepSeek、智谱路由依次使用显式 `apiKeyEnv`、该路由存储的 API Key、原生凭据引用（`DEEPSEEK_API_KEY`、`ZAI_CODING_CN_API_KEY` / `ZAI_API_KEY`）。显式引用缺失时显示错误，禁止改用其他账号的默认 Key。
- 自定义服务地址、覆盖认证请求头或无法确认凭据的旧路由会显示归属错误，不拿官方账号余额冒充该路由余额。

官方 `deepseek-account` 登录账户余额继续由官方界面提供，插件的 DeepSeek 余额用于 API Key 路由。

## 开发

```bash
for file in lib/*.js; do node --check "$file"; done
node --test
```
