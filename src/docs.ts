import { Hono } from "hono";
import { openapi } from "./openapi";

export const docs = new Hono();

docs.get("/openapi.json", (c) => c.json(openapi));
docs.get("/docs", (c) => c.html(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BBModel API 文档</title><link rel="stylesheet" href="/docs-assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="/docs-assets/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true});</script></body></html>`));

docs.get("/docs-assets/:file", async (c) => {
  const file = c.req.param("file");
  if (file !== "swagger-ui.css" && file !== "swagger-ui-bundle.js") return c.notFound();
  return new Response(Bun.file(`node_modules/swagger-ui-dist/${file}`));
});
