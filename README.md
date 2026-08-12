# dsh-deeplink — WebUI 深链插件

DeepSeek Harness Web UI 插件：用链接参数直接打开**指定的项目对话**，不再永远跳回上一个会话。

- `?session=<会话id>` → 打开指定会话
- `?workspace=<工程id>` → 打开指定工程的最新/空白会话
- 内置一条模型提示词，让模型在回复涉及其他对话/工程时自动给出可点击的深链

发布于 [dsh-external](https://github.com/dsh-external) 组织 · 许可证 MIT

> 本组织为 DSH 内测社区仓库，官方不保证公开发布后该组织仍然存在，请自行保留副本。

## 实现能力

- 读取页面 URL 的 `?session=` / `?workspace=` 查询参数，等会话/工程列表基线就绪后切换目标
- 会话与工程参数同时出现时，`session` 优先
- 参数指向的会话/工程不存在（或已归档隐藏）时，静默回落到默认行为（恢复上次会话），不报错、不影响页面
- 插件只读取链接、不改写地址栏；页面内手动切换会话不改变 URL
- node 半注册全局提示词 section，让模型知道深链存在，并在回复中引用其他对话/工程时附上链接
- 纯浏览器端 + 轻量 node 半，不导入 cordis，无 peerDependencies

## 安装

本插件通过标准的 `dsh plugin` 机制安装到 profile，**无需修改 DSH 源码**。

```sh
# 官方 profile（自带 dsh-base + dsh-web-app，插件需要的 systemPrompt/httpServer 由它们提供）：
dsh plugin --profile web add github:dsh-external/dsh-deeplink
# 或本地 checkout：
dsh plugin --profile web add /path/to/dsh-deeplink
```

仓库包含构建产物（`lib/` 已提交），安装后无需另外构建。

安装后重启 Web UI 并刷新浏览器页面，插件会出现在浏览器引导图（`__DSH_BOOT__`）中。

## 使用

在 WebUI 地址后附加查询参数：

| 参数 | 含义 | 示例 |
|---|---|---|
| `?session=<会话id>` | 打开该会话（对话） | `http://127.0.0.1:3080/?session=session-304ae36e-1e66-453a-a946-2b0a9a2b173d` |
| `?workspace=<工程id>` | 打开该工程的最新/空白会话 | `http://127.0.0.1:3080/?workspace=fc8b75ae-107c-4b6c-978c-276270b03b8b` |

新窗口/标签页行为：

- 从对话里点击深链：GUI 的 markdown 渲染器对 http(s) 链接统一加 `target="_blank"`，因此会开新标签页，插件在新标签页里切换到目标会话。
- 直接在当前标签页地址栏粘贴 `?session=...` 并回车：本页切换。

## 模型提示词

node 半注册一条全局提示词 section（`plugin:dsh-deeplink`，order −97，位于 web-surface 之后、persona 之前），告诉模型：

- 本 GUI 支持 `?session=` / `?workspace=` 深链（点击后在新标签页打开）；
- 当回复涉及**其他对话/工程**（先前讨论、别的 workspace、另一会话的后续）时，可附上对应链接，让用户一键跳转；
- 如何发现真实 id：读 `$DSH_HOME/storages/workspace.json`（`tables.workspaces` 的键是工程 id，每个记录的 `sessionIds` 是会话 id），或列 `$DSH_HOME/sessions/<工程>/` 目录（目录名即会话 id）；
- 只输出真实存在的 id，禁止编造。

## 如何找到 id

- 会话 id：`~/.dsh/sessions/--工程名--/<session-id>/` 目录名；或 `~/.dsh/storages/workspace.json` 中 `tables.workspaces[].sessionIds`。
- 工程 id：`~/.dsh/storages/workspace.json` 中 `tables.workspaces` 的键（UUID）。

## 开发 / Develop

- 浏览器半 `lib/client.js`：改动会被运行中的服务器 HMR 自动感知（stat-poll，约 0.5s），刷新页面即生效。
- node 半 `lib/index.js`：改动需**重启 `dsh web`** 生效。
- 本插件无构建步骤；`lib/` 直接手写提交。

## 版本兼容

浏览器半纯客户端：不导入 cordis、无 peerDependencies，只依赖 runtime 提供的 `sessions` / `workspaces` 服务及其 `list` 快照。node 半依赖 `systemPrompt` / `httpServer` 服务（dsh-base 与 web 组合均已提供）。与 snapshot0811+ / npm `0.0.1-rc.*` 兼容。

## 许可证 / License

[MIT](./LICENSE) · Copyright (c) 2026 DSH Community Contributors

## 更新记录 / Changelog

### 2026-08-12 · v0.3.0 — 撤销新窗口参数，统一新标签打开

- 撤销 `&new=1` 的 `window.open` 逻辑（渲染器已对 http 链接强制 `_blank`，`new` 会造成双窗口）。
- 提示词与 README 同步：深链点击即新标签打开。

### 2026-08-12 · v0.2.0 — 新窗口模式 + 模型提示词（已撤销）

- （撤销）`&new=1` 新窗口模式。
- node 半注册 `plugin:dsh-deeplink` 提示词 section：让模型知道深链存在，回复涉及其他对话/工程时可附链接。

### 2026-08-12 · v0.1.0 — 初版

- `?session=` / `?workspace=` 深链支持；未知目标静默回落；只读不写回。
