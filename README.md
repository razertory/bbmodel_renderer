# bbmodel_renderer

独立的 bbmodel 预览渲染服务：接收模型 URL，渲染五视图合成一张 WebP，上传 S3，返回存储路径与公开图片 URL。

Bun + Hono。异步任务化：`POST /v1/previews` 返回 202，轮询 `GET /v1/tasks/:taskId` 获取结果。

## API

### POST /v1/previews

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
{"modelUrl": "https://storage.example.com/models/example.bbmodel", "requestId": "model-version-uuid"}
```

- `202` 任务已入队：`{taskId, requestId, status: "queued" | "running"}`
- `400` 请求或 URL 格式错误；`401` 鉴权失败；`429` 限流 / 队列满
- 相同 `requestId` 的在途任务会去重（直接返回同一 taskId）；ready 任务有 60s 去重窗口，failed 任务可立即重试

### GET /v1/tasks/:taskId

- `ready`：`result.storageKey`（持久化用）+ `result.url`（公开图片 URL）+ `width/height/warnings`
- `failed`：`error.code` ∈ INVALID_URL / INVALID_MODEL / MODEL_TOO_LARGE / TOO_MANY_ELEMENTS / DOWNLOAD_FAILED / SSRF_BLOCKED / RENDER_FAILED / RENDER_TIMEOUT / UPLOAD_FAILED

## 渲染管线

下载（SSRF 防护：HTTPS only、私网/云元数据 IP 拦截、DNS 解析校验、重定向 ≤3、大小上限、超时）
→ 校验 bbmodel（元素数 / 纹理限制）
→ 内容哈希 `sha256` 缓存检查（S3 HEAD，命中直接返回）
→ 无头 Chromium + three-blockbench 渲染五视图（isometric/front/back/left/right，带标签，3×2 网格 1536×1024 WebP）
→ PutObject 到 `S3_PREFIX<hash>/multiview-v1/composite.webp` → 根据 `PUBLIC_BASE_URL` 生成公开 URL

页面 serviceWorkers 禁用、外部 HTTP 请求全部 abort —— 纹理必须内嵌于 bbmodel。

## 开发

```bash
bun install
bun run build:renderer   # 构建浏览器端渲染 bundle (assets/renderer.bundle.js)
bunx playwright-core install chromium   # 首次需要
bun run dev              # 热重载
bun test                 # 20 个单元/集成测试
```

配置见 `.env.example`。

### 选择独立视角

提交时可传入 `views` 数组，例如：

```json
{"modelUrl":"https://storage.example.com/models/example.bbmodel","views":["front","top","isometric"]}
```

支持 `isometric`、`front`、`back`、`left`、`right`、`top`、`bottom`，数组须非空且不重复。每个视角单独生成一张 515×512 WebP；任务完成后，`result.images` 按请求顺序返回，每项包含 `view`、`storageKey`、`url`、`width` 和 `height`，`result.warnings` 为任务警告。省略 `views` 时保持原有五视图合成图及响应格式。不同视角选择请使用不同的 `requestId`。

## 交互式 API 文档

启动服务后访问 `/docs` 查看 Swagger UI，通过 **Authorize** 输入 API Key 后可直接调试接口。OpenAPI 描述文件位于 `/openapi.json`。
