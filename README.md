# dsh-edu

在 DeepSeek Harness 输入框下方显示当前模型对应的额度或余额：

- **ChatGPT Codex**：5 小时 / 7 天限额
- **Grok / SuperGrok**：周限额
- **DeepSeek 官方 API**：账户余额
- **智谱 GLM（bigmodel / z.ai）**：现金余额（悬停可看生效的 Token 资源包）

面向 **官方桌面**（`connection.fetch`）。不另存 token，只在 Host 侧通过 DSH `credentials` 读取本机已有凭据；浏览器只请求 `/api/dsh-edu`，响应里只有用量/余额数字，不含密钥。当前模型不属于上述提供方时不显示、也不打对应官方接口。结果缓存 3 分钟。

不读取 `~/.grok/auth.json` / `~/.codex/auth.json`。

## 安装

复制到 `$DSH_HOME/plugins/dsh-edu`（默认 `$DSH_HOME` 为 `~/.dsh`），在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 写入：

```yaml
- insert:
    - id: dsh-edu
      name: ../../plugins/dsh-edu/lib/index.js
```

完全退出 DeepSeek Harness（macOS：⌘Q）再打开。

凭据沿用 DSH 已登录账号或已配置的环境变量名：`llm-pi-ai/openai-codex`、`llm-pi-ai/xai`、`DEEPSEEK_API_KEY`、`ZAI_CODING_CN_API_KEY` / `ZAI_API_KEY`。

## 开发

```bash
node --check lib/index.js lib/client.js lib/parse.js
node --test
```
