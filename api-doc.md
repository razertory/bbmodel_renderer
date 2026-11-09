# BBModel 预览渲染 API 接入文档

服务接收 `.bbmodel` 文件的下载地址，异步生成 WebP 预览图。接入流程：**提交任务 → 查询任务 → 使用返回的图片 URL**。

> 本文根据当前代码编写。独立视角功能的线上可用性取决于部署版本。

## 快速开始

配置服务地址和 API Key：

```bash
export BASE_URL='https://prod-main-bbmodel-renderer-013018-00yyb20507g.compute.instacloud-edge.com'
export API_KEY='替换为实际 API Key'
```

提交任务，选择需要的视角：

```bash
curl -X POST "$BASE_URL/v1/previews" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"modelUrl":"https://storage.example.com/models/example.bbmodel","views":["front","top"]}'
```

记下响应中的 `taskId`，查询任务：

```bash
export TASK_ID='替换为返回的 taskId'
curl "$BASE_URL/v1/tasks/$TASK_ID" \
  -H "Authorization: Bearer $API_KEY"
```

当 `status` 为 `ready` 时，从 `result.images` 获取各视角的图片 URL；为 `queued` 或 `running` 时继续轮询；为 `failed` 时查看 `error`。

### API Key 和存储路径

- `API_KEY` 用于鉴权，所有 `/v1/*` 请求都需要通过 `Authorization: Bearer <API_KEY>` 请求头提供。服务端使用 `RENDER_API_KEY` 配置该值。请通过安全渠道获取，并保存在调用方服务端环境变量中。
- `storageKey` 是服务返回的图片存储路径，供需要持久化存储引用的调用方使用。提交任务时无需填写；仅通过 URL 使用图片的调用方可以忽略它。
- `requestId` 是可选的任务追踪和去重标识，省略时由服务生成。

## 提交预览任务

`POST /v1/previews`

请求体为 JSON：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `modelUrl` | 字符串 | 是 | `.bbmodel` 文件的 HTTPS 下载地址，服务端必须能访问。纹理需要内嵌在模型中。 |
| `views` | 字符串数组 | 否 | 要单独生成图片的视角。数组必须非空，视角不能重复；返回顺序与请求顺序一致。省略时生成五视图合成图。 |
| `requestId` | 字符串 | 否 | 调用方提供的追踪及去重标识；省略或传空字符串时由服务生成。 |

`modelUrl` 必须在服务下载模型时有效。内网、localhost 和云元数据等地址会被拦截。默认文件大小上限为 50 MiB，实际限制以部署配置为准。

### 支持的视角

| 值 | 视角 |
| --- | --- |
| `isometric` | 等距 |
| `front` | 前 |
| `back` | 后 |
| `left` | 左 |
| `right` | 右 |
| `top` | 上 |
| `bottom` | 下 |

指定 `views` 后，每个视角生成一张 **515 × 512** 的 WebP 图片。例如，只需要正面时传 `"views":["front"]`。传入空数组、重复视角或不支持的视角会返回 `400 INVALID_REQUEST`。

省略 `views` 时，生成一张 **1536 × 1024** 的五视图合成图，包含等距、前、后、左、右视角，按 3 × 2 网格排列。两种模式的结果结构见下文。

### 提交响应与去重

成功提交返回 HTTP `202`，例如：

```json
{
  "taskId": "task_example",
  "requestId": "生成或传入的请求标识",
  "status": "running"
}
```

响应状态也可能为 `queued`。同一 `requestId` 的排队中、运行中任务会复用；成功后 60 秒内也会复用，因此提交响应可能直接为 `ready` 并包含 `result`。失败任务可立即重新提交。

去重只依据 `requestId`，不会比较模型 URL 或视角。不同模型版本或视角组合应使用不同的 `requestId`；省略该字段时，每次提交会生成新的标识。

## 查询任务

`GET /v1/tasks/{taskId}`

HTTP `200` 响应的 `status` 表示任务状态：

| 状态 | 说明 |
| --- | --- |
| `queued` | 等待执行，继续轮询。 |
| `running` | 正在执行，继续轮询。 |
| `ready` | 渲染完成，读取 `result`。 |
| `failed` | 任务失败，读取 `error.code` 和 `error.message`。 |

建议每 2～5 秒轮询一次并设置调用方超时；遇到 `429` 时退避重试。提交和查询共用接口限流，默认每个 API Key 每分钟 30 次，实际限制以部署配置为准。

### 独立视角结果

请求中包含 `views` 时，成功响应例如：

```json
{
  "taskId": "task_example",
  "requestId": "request_example",
  "status": "ready",
  "result": {
    "images": [
      {
        "view": "front",
        "storageKey": "blocky/previews/<内容哈希>/views-v1/front.webp",
        "url": "https://storage.example.com/正面图片的公开地址",
        "width": 515,
        "height": 512
      },
      {
        "view": "top",
        "storageKey": "blocky/previews/<内容哈希>/views-v1/top.webp",
        "url": "https://storage.example.com/顶部图片的公开地址",
        "width": 515,
        "height": 512
      }
    ],
    "warnings": []
  }
}
```

### 五视图合成结果

省略 `views` 时，成功响应例如：

```json
{
  "taskId": "task_example",
  "requestId": "request_example",
  "status": "ready",
  "result": {
    "storageKey": "blocky/previews/<内容哈希>/multiview-v1/composite.webp",
    "url": "https://storage.example.com/合成图片的公开地址",
    "width": 1536,
    "height": 1024,
    "warnings": []
  }
}
```

### 图片地址与任务保留

`url` 是无需签名参数的公开图片地址，其可用性取决于存储对象与公开访问配置。`storageKey` 可用于持久化记录，使用它读取对象需要相应存储访问权限。

任务状态保存在服务进程内，服务重启后可能无法查询；完成的旧任务也可能被清理。调用方应及时保存需要的结果信息，并处理 `TASK_NOT_FOUND`。

## 错误处理

请求错误通常返回 `{ "requestId": null, "error": { "code": "...", "message": "..." } }`，部分错误会带请求标识。HTTP `202` 表示任务已受理；下载、校验、渲染和上传错误需要通过任务查询获取。

失败任务示例：

```json
{
  "taskId": "task_example",
  "requestId": "request_example",
  "status": "failed",
  "error": {
    "code": "DOWNLOAD_FAILED",
    "message": "failed to download model"
  }
}
```

| HTTP 状态 / 错误码 | 说明与建议 |
| --- | --- |
| `400 INVALID_REQUEST` / `INVALID_URL` | 检查 JSON、模型地址和视角参数。 |
| `401 MISSING_API_KEY` / `INVALID_API_KEY` | 检查 Bearer 请求头和 API Key。 |
| `404 TASK_NOT_FOUND` | 任务不存在或已丢失；根据业务需要重新提交。 |
| `429 RATE_LIMITED` / `QUEUE_FULL` | 降低请求频率，等待后退避重试。 |
| 任务 `failed`：`INVALID_URL` / `DOWNLOAD_FAILED` | 检查 HTTPS 地址、公网可访问性和下载链接有效期。 |
| 任务 `failed`：`INVALID_MODEL` / `MODEL_TOO_LARGE` / `TOO_MANY_ELEMENTS` | 检查模型格式、大小和元素数量。 |
| 任务 `failed`：`RENDER_FAILED` / `RENDER_TIMEOUT` / `UPLOAD_FAILED` | 记录错误信息并按需重试；持续失败时联系服务维护方。 |

## 健康检查

`GET /health` 无需 API Key：

```bash
curl "$BASE_URL/health"
```

示例响应：`{"status":"ok","queue":0,"concurrency":2}`。`queue` 包含等待和运行中的任务数。
