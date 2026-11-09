import { VIEWS } from "./render/views";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json(ref("ErrorResponse")) });
const imageFields = {
  storageKey: { type: "string", description: "图片存储路径" },
  url: { type: "string", format: "uri", description: "临时签名 URL，任务查询不会刷新签名" },
  expiresAt: { type: "string", format: "date-time" },
  width: { type: "integer" },
  height: { type: "integer" },
};

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "BBModel 预览渲染 API",
    version: "1.0.0",
    description: "提交模型 URL，轮询任务状态，获取 WebP 预览图。API Key 用于 /v1 接口鉴权。图片 URL 默认有效期为 600 秒，任务状态保存在服务进程内。",
  },
  paths: {
    "/health": {
      get: {
        summary: "健康检查", security: [],
        responses: { "200": { description: "服务状态", content: json({ type: "object", properties: { status: { type: "string", example: "ok" }, queue: { type: "integer" }, concurrency: { type: "integer" } } }) } },
      },
    },
    "/v1/previews": {
      post: {
        summary: "提交预览任务",
        description: "传入 views 生成各视角的独立图片；省略 views 生成五视图合成图。相同 requestId 会复用在途或 60 秒内完成的任务，去重不比较模型或视角。",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: json(ref("PreviewRequest")) },
        responses: {
          "202": { description: "任务已受理，重复请求可能返回已完成任务", content: json(ref("Task")) },
          "400": error("JSON、URL 或视角参数无效"), "401": error("鉴权失败"), "429": error("限流或队列已满"),
        },
      },
    },
    "/v1/tasks/{taskId}": {
      get: {
        summary: "查询任务状态", security: [{ bearerAuth: [] }],
        parameters: [{ name: "taskId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "查询成功；status 为 ready 时读取 result，为 failed 时读取 error", content: json(ref("Task")) },
          "401": error("鉴权失败"), "404": error("任务不存在"), "429": error("请求过于频繁"),
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "服务配置的 API Key" } },
    schemas: {
      PreviewRequest: {
        type: "object", required: ["modelUrl"],
        properties: {
          modelUrl: { type: "string", format: "uri", example: "https://storage.example.com/models/example.bbmodel", description: "公网 HTTPS 模型下载地址；纹理须内嵌" },
          views: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: VIEWS }, example: ["front", "top"], description: "每个视角生成一张 515×512 图片；省略时生成 1536×1024 五视图合成图" },
          requestId: { type: "string", description: "可选追踪和去重标识；不同模型或视角组合应使用不同标识" },
        },
      },
      Image: { type: "object", required: ["view", ...Object.keys(imageFields)], properties: { view: { type: "string", enum: VIEWS }, ...imageFields } },
      SeparateResult: { type: "object", required: ["images", "warnings"], properties: { images: { type: "array", items: ref("Image") }, warnings: { type: "array", items: { type: "string" } } } },
      CompositeResult: { type: "object", required: [...Object.keys(imageFields), "warnings"], properties: { ...imageFields, warnings: { type: "array", items: { type: "string" } } } },
      Error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } },
      ErrorResponse: { type: "object", required: ["requestId", "error"], properties: { requestId: { type: "string", nullable: true }, error: ref("Error") } },
      Task: { type: "object", required: ["taskId", "requestId", "status"], properties: { taskId: { type: "string" }, requestId: { type: "string" }, status: { type: "string", enum: ["queued", "running", "ready", "failed"] }, result: { oneOf: [ref("SeparateResult"), ref("CompositeResult")] }, error: ref("Error") } },
    },
  },
};
