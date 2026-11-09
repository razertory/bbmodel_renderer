# BBModel 预览渲染 API 接入文档

服务接收 `.bbmodel` 文件的下载地址，异步生成五视图 WebP 预览图。接入流程：提交任务 → 轮询任务状态 → 使用返回的图片地址。

## 服务地址与鉴权

线上基础地址：

```text
https://prod-main-bbmodel-renderer-013018-00yyb20507g.compute.instacloud-edge.com
```

所有 `/v1/*` 接口都需要请求头 `Authorization: Bearer <API_KEY>`。API Key 使用服务端配置的 `RENDER_API_KEY`，请通过安全渠道获取并保存在调用方服务端的环境变量中，避免放进浏览器代码或公开仓库。

下面的示例需要先设置环境变量：

```bash
export BASE_URL='https://prod-main-bbmodel-renderer-013018-00yyb20507g.compute.instacloud-edge.com'
export API_KEY='替换为实际 API Key'
```

## 1. 提交预览任务

`POST /v1/previews`

```bash
curl -X POST "$BASE_URL/v1/previews" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"modelUrl":"https://storage.example.com/models/example.bbmodel","requestId":"model-version-001"}'
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `modelUrl` | 是 | 服务端可访问的 `.bbmodel` 文件 HTTPS 下载地址。内网、localhost 和云元数据等地址会被拦截；文件中的纹理需要内嵌。 |
| `requestId` | 否 | 调用方的任务标识；省略或传空字符串时由服务生成。建议使用模型版本 ID，方便追踪和去重。 |

服务会下载文件，因此 `modelUrl` 需要在下载时仍然有效。默认文件大小上限为 50 MiB，实际限制以线上配置为准。

成功响应 HTTP `202`：

```json
{
  "taskId": "task_example",
  "requestId": "model-version-001",
  "status": "running"
}
```

提交响应中的状态也可能是 `queued`。相同 `requestId` 的排队中或运行中任务会返回同一个任务；成功后 60 秒内也会复用该任务，因此提交响应还可能是 `ready` 并包含 `result`。失败任务可立即重新提交。请为不同模型版本使用不同的 `requestId`。

## 2. 查询任务

`GET /v1/tasks/{taskId}`

将提交响应的 `taskId` 代入：

```bash
export TASK_ID='替换为返回的 taskId'
curl "$BASE_URL/v1/tasks/$TASK_ID" \
  -H "Authorization: Bearer $API_KEY"
```

HTTP `200` 响应的 `status` 表示任务状态：

| 状态 | 说明 |
| --- | --- |
| `queued` | 等待执行，继续轮询。 |
| `running` | 正在执行，继续轮询。 |
| `ready` | 渲染完成，读取 `result`。 |
| `failed` | 渲染失败，读取 `error.code` 和 `error.message`。 |

建议每 2～5 秒轮询一次，并设置调用方超时；遇到 `429` 时退避重试。提交和查询共用接口限流，默认每个 API Key 每分钟 30 次，实际限制以线上配置为准。

成功示例：

```json
{
  "taskId": "task_example",
  "requestId": "model-version-001",
  "status": "ready",
  "result": {
    "storageKey": "blocky/previews/<内容哈希>/multiview-v1/composite.webp",
    "url": "https://storage.example.com/预览图的临时签名地址",
    "expiresAt": "2026-01-01T00:10:00.000Z",
    "width": 1536,
    "height": 1024,
    "warnings": []
  }
}
```

`url` 是有时效的签名地址，`expiresAt` 为到期时间；默认有效期 600 秒，实际以返回值为准。`storageKey` 可用于持久化记录，读取对象需要调用方具备相应存储访问能力。任务查询返回的是任务完成时生成的 URL，不会刷新签名；服务当前没有单独的签名刷新接口。图片包含等距、前、后、左、右五个视图，排列在 3×2 网格中。

失败示例：

```json
{
  "taskId": "task_example",
  "requestId": "model-version-001",
  "status": "failed",
  "error": {
    "code": "DOWNLOAD_FAILED",
    "message": "failed to download model"
  }
}
```

任务状态保存在服务进程内，服务重启后可能无法查询；完成的旧任务也可能被清理。调用方应及时保存需要的结果信息，并处理 `TASK_NOT_FOUND`。

## 错误处理

接口错误通常返回 `{ "requestId": null, "error": { "code": "...", "message": "..." } }`，部分错误会带提交时的 `requestId`。

| HTTP 状态 / 错误码 | 说明与建议 |
| --- | --- |
| `400 INVALID_REQUEST` / `INVALID_URL` | 检查 JSON、必填字段和 URL 格式。 |
| `401 MISSING_API_KEY` / `INVALID_API_KEY` | 检查 Bearer 请求头和 API Key。 |
| `404 TASK_NOT_FOUND` | 任务不存在或已丢失；根据业务需要重新提交。 |
| `429 RATE_LIMITED` / `QUEUE_FULL` | 降低请求频率，等待后退避重试。 |
| 任务 `failed`：`INVALID_URL` / `DOWNLOAD_FAILED` | 检查 HTTPS 地址、公网可访问性和下载链接有效期。 |
| 任务 `failed`：`INVALID_MODEL` / `MODEL_TOO_LARGE` / `TOO_MANY_ELEMENTS` | 检查模型格式和大小、元素数量。 |
| 任务 `failed`：`RENDER_FAILED` / `RENDER_TIMEOUT` / `UPLOAD_FAILED` | 记录错误信息并按需重试；持续失败时联系服务维护方。 |

HTTP `202` 只代表任务已受理，实际下载、校验和渲染错误需要通过任务查询获取。

## 健康检查

`GET /health` 无需 API Key：

```bash
curl "$BASE_URL/health"
```

示例响应：`{"status":"ok","queue":0,"concurrency":2}`。`queue` 包含等待和运行中的任务数。
