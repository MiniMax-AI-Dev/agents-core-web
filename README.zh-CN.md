# Agents Core Web

[English](README.md) | **简体中文**

[Agents Core Web](https://github.com/MiniMax-AI-Dev/agents-core-web) 是一个面向独立部署的
[Parsar Agents API Core](https://github.com/MiniMax-AI-Dev/parsar/tree/main/services/agents-api)
的开源 Web 控制台和 TypeScript 客户端。它提供可复用的 Agent 管理、持久化的 Session 对话、
实时进度、已保存的 Item、取消操作以及函数结果回传能力，无需将 Core 复制到本仓库中。

本 Web 也可以连接其他实现了本客户端所使用的相同 HTTP 资源和 SSE 行为的 Core。
这里的“兼容”是指[协议覆盖范围](docs/protocol-coverage.md)中记录并经过测试的子集，
而不是与 OpenAI 托管的 Agents API 完全兼容。

> 当前基线：本文档已针对 Parsar
> [`8cc2898c`](https://github.com/MiniMax-AI-Dev/parsar/commit/8cc2898ca42b272cb3771234ee6a0ad0d2e932ba)
> 及其固定使用的 `openai-python` 3.13.0 beta Agents 资源完成核对。Parsar `main` 和
> 上游 beta API 都可能发生变化；升级前请重新运行兼容性检查。

## 与 Parsar 的关系

| 仓库 / 组件 | 职责 | 本地 Web 聊天是否需要？ |
| --- | --- | --- |
| **Agents Core Web——本仓库** | React/Vite UI、`@agents-core-web/agents-client`、同源开发代理 | 是 |
| **Parsar `services/agents-api`** | 鉴权、Agent/Session/Turn/Item 持久化、SSE、准入与调度 | 是 |
| **Parsar `parsar-daemon`** | 同租户执行设备和原生执行适配层（harness）桥接 | 执行消息时需要；Agent CRUD 或空闲 Session 不需要 |
| **Codex app-server 或 Claude Agent SDK** | daemon 主机上的原生 Agent 执行，以及模型提供商/工具访问 | 执行真实 Turn 时需要 |
| **Parsar 产品栈** | 产品 Web、组织、团队、成员、计费 | 否；它属于独立的产品边界 |

Agents Core Web 只开发第一行中的内容。Agent Core、daemon 和原生适配器仍位于
[MiniMax-AI-Dev/parsar](https://github.com/MiniMax-AI-Dev/parsar)；这些组件的修复应贡献到上游，
而不是复制到本仓库中。

## 架构

```mermaid
flowchart LR
  user["User"]

  subgraph webrepo["agents-core-web · this repository"]
    ui["React + Vite UI"]
    client["@agents-core-web/agents-client"]
    edge["Development proxy<br/>Production reverse proxy / BFF"]
    ui --> client --> edge
  end

  subgraph parsarrepo["MiniMax-AI-Dev/parsar · upstream"]
    core["services/agents-api<br/>standalone Agent Core"]
    db[("Dedicated PostgreSQL")]
    gateway["Internal daemon gateway"]
    daemon["parsar-daemon"]
    harness["Codex app-server<br/>or Claude Agent SDK"]

    core <--> db
    core <--> gateway
    gateway <-->|"authenticated reverse WebSocket"| daemon
    daemon --> harness
  end

  compatible["Another Core implementing<br/>the Web-used API subset"]
  provider["Model provider / MCP / tools"]
  user --> ui
  edge -->|"HTTP JSON + SSE stream<br/>Bearer + OpenAI-Beta: agents=v1"| core
  client -. "direct CORS URL<br/>tab-scoped bearer" .-> compatible
  harness --> provider
```

浏览器绝不会与 `parsar-daemon` 直接通信。daemon WebSocket 是 Parsar 的内部传输协议，
它不是 Agents API URL，也不应填入 Web 连接对话框。当前固定版本的原版 Core 没有安装
浏览器 CORS 中间件，因此其支持的本地连接方式是同源 `/v1` 代理。直连 URL 只适用于
明确启用了 CORS 的其他兼容 Core。详见[架构说明](docs/architecture.md)。

## 可正常聊天的本地快速启动

下面的流程会启动完整的本地链路。只启动 PostgreSQL 和 HTTP Core 足以创建 Agent 和
空闲 Session，但此时提交消息会按设计返回 `503 execution_unavailable`。

要求：

- 本仓库需要 Node.js 22.12+ 和 pnpm 10.30.3；
- 当前 Parsar checkout 需要 Go 1.25.13 和支持 Compose 的 Docker；
- 本地调用方凭据示例需要 `openssl` 和 `uuidgen`；
- daemon 主机上需要一个受支持的原生 harness，并已完成其模型提供商鉴权。

以下命令假设本仓库和 Parsar 分别位于不同的 checkout 中。它们使用专用的本地
PostgreSQL 数据库，而不是 Parsar 产品数据库。

### 1. 启动专用 PostgreSQL

在 Parsar 仓库中运行：

```bash
cd /path/to/parsar

PARSAR_PG_USER=agents_api \
PARSAR_PG_PASSWORD=agents_api_local \
PARSAR_PG_DB=agents_api \
PARSAR_POSTGRES_PORT=15433 \
docker compose \
  --project-name parsar-agents-api \
  --file docker-compose.dev.yml \
  up -d --wait postgres
```

### 2. 创建调用方主体和 bearer 文件

Core **不会**自动生成此 API bearer。运维人员需要为调用方创建一个明文 bearer，
而 Core 的密钥绑定中只保存它的 SHA-256 摘要。当前 Core 要求绑定记录包含全部六个字段：

```bash
(
  set -euo pipefail
  set -o noclobber
  umask 077

  agent_core_state="$HOME/.parsar/agents-api"
  mkdir -p "$agent_core_state"
  chmod 700 "$agent_core_state"

  for agent_core_file in web-token tenant-id keys.json; do
    if [ -e "$agent_core_state/$agent_core_file" ]; then
      printf 'Refusing to overwrite %s\n' "$agent_core_state/$agent_core_file" >&2
      exit 1
    fi
  done

  agent_core_tenant="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  agent_core_token="$(openssl rand -hex 32)"
  printf '%s' "$agent_core_token" > "$agent_core_state/web-token"
  printf '%s\n' "$agent_core_tenant" > "$agent_core_state/tenant-id"
  agent_core_digest="$(openssl dgst -sha256 "$agent_core_state/web-token" | awk '{print $NF}')"

  printf '[{\n  "tenant_id": "%s",\n  "organization_id": "local",\n  "project_id": "agents-core-web",\n  "subject_kind": "service_account",\n  "subject_id": "agents-core-web-local",\n  "token_sha256": "%s"\n}]\n' \
    "$agent_core_tenant" "$agent_core_digest" > "$agent_core_state/keys.json"

  chmod 600 \
    "$agent_core_state/keys.json" \
    "$agent_core_state/web-token" \
    "$agent_core_state/tenant-id"
)
```

`organization_id`、`project_id` 和 subject 都是显式的执行服务 ID；它们不会从 Parsar
产品账号中查询。`subject_kind` 可以是 `service_account` 或 `user`。`keys.json` 包含
主体元数据和 bearer 摘要；独立的 `web-token` 文件包含 Web 本地服务端代理使用的明文值。

### 3. 迁移并启动已启用执行能力的 Agent Core

先运行一次迁移，然后保持服务器在前台运行：

```bash
cd /path/to/parsar

AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
  go run ./services/agents-api/cmd/migrate

env \
  -u AGENTS_API_EXECUTOR_URL \
  -u AGENTS_API_EXECUTOR_KEYS_FILE \
  -u AGENTS_API_HARNESS_KEYS_FILE \
  AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
  AGENTS_API_KEYS_FILE="$HOME/.parsar/agents-api/keys.json" \
  AGENTS_API_ADDR='127.0.0.1:8091' \
  AGENTS_API_ENGINE='codex' \
  AGENTS_API_DAEMON_WS_URL='ws://127.0.0.1:8091/api/v1/agent-daemon/ws' \
  go run ./services/agents-api/cmd/server
```

`AGENTS_API_ENGINE` 为**新建 Session**选择原生执行 profile；它与创建 Agent 时输入的
model ID 相互独立。只有在有意启动不支持 Turn 执行的纯 API 环境时，才应省略
`AGENTS_API_DAEMON_WS_URL`。

### 4. 注册并连接同租户 daemon

在另一个终端中，从 Parsar 仓库运行以下操作。首先确保选定的 harness 已安装并在该主机上
配置完成。默认引擎需要可正常工作的 `codex` 二进制文件；如果它不在 `PATH` 中，请设置
`PARSAR_CODEX_BIN=/absolute/path/to/codex`。

创建一个新的 daemon profile，且不覆盖已有凭据：

```bash
(
  set -euo pipefail
  umask 077

  cd /path/to/parsar

  agent_core_state="$HOME/.parsar/agents-api"
  daemon_profile='agents-api-local'
  daemon_root="${PARSAR_HOME:-$HOME/.parsar}/parsar-daemon"
  daemon_profile_dir="$daemon_root/$daemon_profile"

  mkdir -p "$daemon_root"
  if ! mkdir -m 700 "$daemon_profile_dir"; then
    printf 'Refusing to reuse daemon profile directory: %s\n' "$daemon_profile_dir" >&2
    exit 1
  fi

  daemon_auth_tmp="$(mktemp "$daemon_profile_dir/auth.json.XXXXXX")"
  trap 'rm -f "$daemon_auth_tmp"' EXIT

  AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
    go run ./services/agents-api/cmd/device \
      --tenant "$(tr -d '\r\n' < "$agent_core_state/tenant-id")" \
      --name 'Agents Core Web local executor' \
      --url 'http://127.0.0.1:8091' \
      > "$daemon_auth_tmp"

  chmod 600 "$daemon_auth_tmp"
  mv "$daemon_auth_tmp" "$daemon_profile_dir/auth.json"
  trap - EXIT

  exec go run ./apps/parsar-daemon/cmd/parsar-daemon \
    connect --profile "$daemon_profile"
)
```

daemon 应输出 `bootstrap ok` 和 `ws connected`。其 `auth.json` 是由 `cmd/device`
生成的独立设备凭据，不能替代 Web API bearer。模型/提供商凭据属于第三类凭据，仍保存在
daemon 或 harness 主机上。仅建立连接不会触发模型调用；第一次真实 Turn 才是权威的执行验证。

对于 Codex，daemon 会在自身状态根目录下为每个 Session 分配受管的 `CODEX_HOME`。
因此，运维人员常规 `~/.codex/auth.json` 中基于文件的登录信息不会被自动继承。优先使用
由 daemon 进程继承的模型/提供商凭据，或经过审核的凭据配置路径。将登录文件复制到某个
Session 的受管 `CODEX_HOME` 目录中，只能作为受控的本地冒烟测试临时方案，而不是生产级 Vault 或
提供商集成方案。

### 5. 启动 Agents Core Web

在本仓库中运行：

```bash
pnpm install
pnpm dev
```

开发服务器会将同源 `/v1` 请求代理到 `http://127.0.0.1:8091`，并自动读取约定的私有
bearer 文件 `~/.parsar/agents-api/web-token`。打开命令输出的 loopback URL，创建或选择
一个 Agent，再创建 Session 并发送消息。

使用标准 Parsar Core 时请保留 `/v1`。它的固定版本服务器没有 CORS 中间件。只有当其他
兼容 Core 明确允许 Web 的源、方法和请求头时，才应输入直连 base URL；该手动
回退方案仅将 bearer 保存在当前标签页的 `sessionStorage` 中。

若要使用其他路径或目标，请将 `.env.example` 复制为 `.env.local` 并设置：

```bash
AGENTS_API_PROXY_TARGET=http://127.0.0.1:8091
AGENTS_API_PROXY_TOKEN_FILE=~/.parsar/agents-api/web-token
```

`AGENTS_API_PROXY_TOKEN` 只能作为服务端进程使用的替代方案，并且不能与文件选项同时设置。
绝不要使用 `VITE_*` 变量保存密钥：Vite 会将这些值嵌入浏览器 JavaScript。

完整安装步骤、纯 API 变体、验证命令、轮换、关闭和故障排查参见
[连接 Agent Core](docs/core-connection.md)。

## Agent、模型与多 Agent

- 已保存的 **Agent** 是可复用配置：包括模型、名称、指令、工具和支持的选项。一个项目可以
  保存多个 Agent。
- **Session** 是持久化对话。每次输入会创建或引导一个 **Turn**；**Item** 是用于恢复的
  持久化消息、函数调用和输出。
- model ID 是传递给所选执行引擎的字符串。Core 当前没有模型目录接口，因此 Web 提供的
  建议只是可编辑提示，不是模型发现机制，也不能证明 daemon 可以运行某个模型。
- “保存多个 Agent”并不等同于协议层面的**多 Agent/Subagents**。后者仍不在当前 Web UI
  和受支持的执行子集范围内。

可以在 `.env.local` 中修改公开的模型建议：

```bash
VITE_AGENT_MODEL_PRESETS=gpt-5.6-sol,gpt-5.6-terra,provider/custom-model
VITE_AGENT_DEFAULT_MODEL=gpt-5.6-sol
```

这些值只能包含模型标识符，绝不能包含提供商凭据。修改后请重启开发服务器或重新构建 Web。

## 通信与协议边界

| 边界 | 协议 | 鉴权 | 含义 |
| --- | --- | --- | --- |
| 浏览器 → 本地代理 / 生产 BFF | 同源 `/v1` HTTP | Web 用户认证/登录会话策略；本地代理将 Core bearer 保留在服务端 | Web 部署边界 |
| 代理 / BFF → Core | `/v1/agents/**` 下的 HTTP JSON 和已鉴权 SSE 流 | `Authorization: Bearer …` 和 `OpenAI-Beta: agents=v1` | 固定版本的 beta Agents API 子集 |
| Core ↔ `parsar-daemon` | Parsar 内部反向 WebSocket 和 JSON envelope | daemon `auth.json` 中的独立设备凭据 | 调度和执行传输，不是 OpenAI Agents API |
| Daemon ↔ Codex | `codex app-server --stdio`，通过换行分隔 JSON 传输 JSON-RPC 2.0 | daemon 主机上的原生配置 | Codex harness 适配器 |
| Daemon ↔ Claude | Claude Agent SDK 桥接 | daemon 主机上的原生配置 | 另一种 harness 适配器 |
| Harness → 提供商 / MCP / 工具 | 提供商原生协议 | 执行主机上的提供商凭据 | 绝不暴露给 Web |

OpenAI 的 [Agents 指南](https://developers.openai.com/api/docs/guides/agents)区分了三个概念：
Agents API 运行托管的 Codex harness；Agents SDK 在应用内部运行 Agent loop；Responses API
是更底层的模型 API。它们不是可以互换的协议。Parsar Core 使用自己的存储和执行运行时，
实现了固定版本 Agents API HTTP 资源形态的一部分；本 Web 不使用 Agents SDK 作为 Core
传输协议。

SSE 只提供实时事件。Web 会在提交输入前打开事件流，但重新连接不会回放丢失的事件，即使
带有 `Last-Event-ID` 也一样。当前 UI 会重新连接并缓冲新事件，然后读取持久化的 Session
和 Item，并按 Item ID 完成对账。TypeScript 客户端提供了 Turn 列表和读取方法用于诊断，
但 UI 在恢复期间尚未读取 Turn。

客户端不会自动重试结果不确定的写请求。当前 UI 在手动重发时也不会复用同一个已生成的
幂等键，因此再次发送输入前应先检查持久化状态。跨重试幂等键持久化和对账竞态加固已在
M1 中跟踪。

## 凭据与信任边界

| 凭据 | 持有方 | 用途 |
| --- | --- | --- |
| `web-token` 明文 bearer | Vite 服务器、反向代理或未来的 BFF | 以一个执行主体的身份认证 HTTP 调用 |
| `keys.json` 绑定 | Agent Core | 将 bearer 摘要绑定到 tenant、organization、project 和 subject ID |
| daemon `auth.json` | `parsar-daemon` 主机 | 认证一个执行设备，使其接入同一 tenant |
| 模型/提供商凭据 | 原生 harness 主机 | 鉴权 Codex/Claude/模型/工具访问 |

这些文件都不是 Parsar 产品登录信息，也不是 Web 的组织级登录会话，而且不同凭据不能互换。优先使用
服务端代理。不要将凭据放入 Git、Session metadata、`localStorage` 或其他持久化浏览器
存储、`VITE_*`、快照或日志。手动直连 Core 的回退方案只适用于启用了 CORS 的兼容 Core，
且凭据仅保存在当前标签页的 `sessionStorage`；这不是生产凭据设计。生产环境必须终止 TLS，
并使用经过鉴权的反向代理/BFF，而不是暴露开发代理。

## 故障排查

| 现象 | 含义 / 处理方式 |
| --- | --- |
| `401 invalid_api_key` | 明文 bearer 与当前 `keys.json` 摘要不匹配，或可选 organization/project header 冲突。重新生成或轮换绑定并重启 Core。 |
| Core 启动时拒绝 `keys.json` | 将旧的双字段绑定更新为当前要求的全部六个主体字段；使用规范且非零的 tenant UUID，以及 `user` 或 `service_account`。 |
| `POST .../events` 返回 `503 execution_unavailable` | 当错误消息精确为 `Execution is not enabled` 时，表示 Core 启动时未配置 gateway/worker。设置 `AGENTS_API_DAEMON_WS_URL`，重启 Core，并连接同租户 daemon。其他 503 可能表示 lease 丢失；重试前先检查 Core 日志。 |
| `/healthz` 正常但聊天失败 | 健康检查只能证明 HTTP 存活。请检查 Core worker 日志、daemon 的 `ws connected`、harness 预检、model ID 和提供商凭据。 |
| Agent 保存成功但其模型运行失败 | 保存配置不等于运行时能力发现。请使用所选 daemon/harness 配置支持的 ID。 |
| 重连后输出消失 | SSE 不会回放事件。让当前 UI 恢复持久化的 Session 和 Item；客户端 Turn 读取可用于诊断。请检查持久化状态，不要盲目重试输入。 |

## 界面设计

UI 沿用 Parsar 已有的 **The Issue Ledger** 视觉系统，而不是另起一套。语义色、系统字体、
导航、ledger 行、对话线程、控件和品牌表现均改编自上游 `apps/web`。本仓库 Agents API
范围以外的产品功能不会被复制进来。

## 仓库结构

```text
apps/web/                 React + Vite product shell
packages/agents-client/  Typed Agents API client and SSE decoder
docs/                     architecture, Core connection, coverage, roadmap, iteration
scripts/                  local issue-intake and private workspace bootstrap
.github/                  checks and the public issue-intake gate
AGENTS.md                 tracked public contributor and Agent policy
.agents/                  ignored private prompts and run state; never commit
```

## 范围与非目标

当前包含：

- 可复用的 Agent 创建与列表；
- 空闲 Session 创建、实时事件订阅、消息输入、取消操作；
- 重新连接后的持久化 Item 恢复，以及函数结果/错误回传；
- 基于 HTTP JSON 和 fetch SSE 的类型化适配器；
- 一个由 Git 忽略、用于 Issue 驱动迭代的隔离 workspace。

明确排除：

- 组织、成员、计费、应用市场以及其他 Parsar 产品逻辑；
- 重新实现或复制 Agent Core、`parsar-daemon`、Codex 或 Claude；
- 将手动、标签页级的 Core token 回退方案视为生产凭据设计，或将 daemon/提供商凭据暴露给浏览器；
- 假设 Docker、E2B 和 AWS Bedrock AgentCore Runtime 可以互换。只有在已连接 Core 发布并证明
  兼容的生命周期合约后，Web 才会暴露相应运行时选项。

## Issue 驱动的自迭代试点

公开的 Agent 任务 Issue 表单创建的是候选任务，而不是执行授权。维护者必须先完成分诊并
添加 `agent-ready` 标签。公开 workflow 会验证受约束的字段，并上传短生命周期的 JSON 任务制品，
不会把 Issue 文本作为代码或 shell 输入执行。

在受信任的 runner 上运行 `pnpm agent:workspace`，创建被忽略的本地 prompt 和状态目录。
受版本控制的根 `AGENTS.md` 是仓库工作的公开基线，会被自动采用。runner 还必须显式加载
私有 `.agents/AGENTS.md` 和 `.agents/issue-agent.md` overlay；Git 会忽略它们，它们不是
自动生效的仓库根指令。全新 clone 只包含占位文件，须由操作人员在本地填写；已提交的
初始化脚本有意不包含私有 prompt。prompt、凭据、计划和运行状态均由操作人员持有。
这一基础能力不包含特权 bot、自动合并、发布或部署路径。
详见[自迭代约定](docs/self-iteration.md)。

## 质量检查

```bash
pnpm check
```

本项目采用 MIT 许可证。贡献必须遵守[架构说明](docs/architecture.md)中的所有权与协议边界；
行为发生变化时，必须同步更新[协议覆盖范围](docs/protocol-coverage.md)。
