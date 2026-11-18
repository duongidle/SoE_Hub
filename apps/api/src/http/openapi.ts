import { z } from "zod";
import { ERROR_CODES } from "@soe/shared";
import type { Registry } from "../core/registry";
import type { Operation } from "../core/types";

type Json = Record<string, unknown>;

/** Zod -> JSON Schema 2020-12 (the dialect of OpenAPI 3.1). Unrepresentable parts become `{}`. */
function toSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any", reused: "inline" }) as Json;
  delete js["$schema"];
  return js;
}

const errorSchema: Json = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: Object.keys(ERROR_CODES) },
        message: { type: "string" },
        details: {},
        request_id: { type: "string" },
      },
    },
  },
};

function errorResponses(op: Operation): Json {
  const codes = new Set<string>(["400", "429", "500"]);
  if (op.permission !== null) {
    codes.add("401");
    codes.add("403");
  }
  if (op.kind === "command") {
    codes.add("409");
    codes.add("422");
  }
  if (/:\w+/.test(op.http.path)) codes.add("404");
  const out: Json = {};
  for (const c of [...codes].sort()) {
    out[c] = {
      description: Object.values(ERROR_CODES).find((e) => String(e.status) === c)?.description ?? "Lỗi",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }
  return out;
}

function pathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
}

function buildOperation(op: Operation): Json {
  const params = pathParams(op.http.path);
  const input = toSchema(op.input, "input");
  const props = (input.properties ?? {}) as Record<string, Json>;
  const required = new Set((input.required ?? []) as string[]);

  const parameters: Json[] = [];
  const bodyProps: Record<string, Json> = {};
  const bodyRequired: string[] = [];
  for (const [name, schema] of Object.entries(props)) {
    const inPath = params.includes(name);
    const inQuery = !inPath && (op.http.method === "GET" || op.http.method === "DELETE");
    if (inPath || inQuery) {
      parameters.push({ name, in: inPath ? "path" : "query", required: inPath || required.has(name), schema, ...(typeof schema.description === "string" ? { description: schema.description } : {}) });
    } else {
      bodyProps[name] = schema;
      if (required.has(name)) bodyRequired.push(name);
    }
  }
  // `filter` is a JSON string in the query string; document it as such.
  for (const p of parameters) {
    if (p.name === "filter" && p.in === "query") p.schema = { type: "string", description: "Bộ lọc JSON (design/module0 mục 6.3)." };
  }
  if (op.kind === "command") {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: false,
      description: "Gửi lại cùng khoá trong 24 giờ thì nhận lại kết quả cũ, không thực hiện lại.",
      schema: { type: "string", minLength: 8, maxLength: 200 },
    });
  }

  const item = op.output ? toSchema(op.output, "output") : {};
  const success = op.list
    ? {
        type: "object",
        required: ["data", "next_cursor"],
        properties: { data: { type: "array", items: item }, next_cursor: { type: ["string", "null"] }, total: { type: "integer" }, ...(op.listExtra ? ((toSchema(op.listExtra, "output").properties as Json | undefined) ?? {}) : {}) },
      }
    : { type: "object", required: ["data"], properties: { data: item } };

  const result: Json = {
    operationId: op.name,
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    tags: op.tags,
    "x-command-name": op.name,
    "x-ai-allowed": op.aiAllowed,
    "x-permission": op.permission,
    ...(parameters.length ? { parameters } : {}),
    ...(Object.keys(bodyProps).length
      ? { requestBody: { required: bodyRequired.length > 0, content: { "application/json": { schema: { type: "object", properties: bodyProps, ...(bodyRequired.length ? { required: bodyRequired } : {}) } } } } }
      : {}),
    responses: {
      [String(op.http.status)]: { description: "Thành công", content: { "application/json": { schema: success } } },
      ...errorResponses(op),
    },
  };
  if (op.permission !== null) result.security = [{ bearerAuth: [] }, { sessionCookie: [], csrfHeader: [] }];
  return result;
}

const errRef = { $ref: "#/components/schemas/Error" };
const errContent = { "application/json": { schema: errRef } };

/** Endpoints that are not registry operations (infrastructure). Listed by hand so the document stays complete. */
function infraPaths(): Json {
  return {
    "/health": {
      get: {
        operationId: "health",
        summary: "Kiểm tra sức khoẻ hệ thống (không cần đăng nhập).",
        tags: ["system"],
        responses: {
          "200": { description: "Hệ thống chạy tốt.", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["ok"] }, db: { type: "string" }, worker: { type: "object" }, time: { type: "string" } } } } } },
          "503": { description: "Database không phản hồi.", content: errContent },
        },
      },
    },
    "/api/v1/events": {
      get: {
        operationId: "events.stream",
        summary: "Luồng sự kiện SSE (chỉ gửi tín hiệu, không gửi dữ liệu).",
        description: "Giữ kết nối mở. Mỗi sự kiện: `{ id, event, aggregate_type, aggregate_id, at }`. Client nhận tín hiệu rồi tải lại đúng dòng qua API có kiểm tra quyền.",
        tags: ["system"],
        "x-permission": "events:subscribe",
        security: [{ bearerAuth: [] }, { sessionCookie: [] }],
        parameters: [{ name: "topics", in: "query", required: false, schema: { type: "string" }, description: "Tiền tố tên sự kiện, ngăn cách bằng dấu phẩy, ví dụ `datahub.row,deal`." }],
        responses: { "200": { description: "Luồng `text/event-stream`.", content: { "text/event-stream": { schema: { type: "string" } } } }, "401": { description: "Chưa đăng nhập.", content: errContent }, "403": { description: "Không có quyền.", content: errContent } },
      },
    },
    "/api/auth/google/start": {
      get: {
        operationId: "auth.google.start",
        summary: "Bắt đầu đăng nhập Google (chuyển hướng sang Google). Chỉ dùng được khi Admin bật `auth.google_enabled`.",
        tags: ["auth"],
        responses: { "302": { description: "Chuyển hướng tới trang đăng nhập Google." }, "404": { description: "Đăng nhập Google đang tắt.", content: errContent } },
      },
    },
    "/api/auth/callback/google": {
      get: {
        operationId: "auth.google.callback",
        summary: "Google gọi lại sau khi đăng nhập. Email phải có trong org chart; lần đầu bắt buộc đặt mật khẩu.",
        tags: ["auth"],
        parameters: ["code", "state"].map((name) => ({ name, in: "query", required: true, schema: { type: "string" } })),
        responses: { "302": { description: "Về trang chủ (hoặc trang đặt mật khẩu, hoặc trang đăng nhập kèm lỗi)." } },
      },
    },
    "/api/v1/storage/local/put": {
      put: {
        operationId: "storage.local.put",
        summary: "Tải file lên kho lưu trữ local (chỉ dùng khi STORAGE_DRIVER=local, tức dev).",
        description: "Link do `file.upload.init` trả về, đã ký và có hạn. Không cần đăng nhập vì chữ ký là bằng chứng.",
        tags: ["file"],
        parameters: ["key", "exp", "ct", "fn", "sig"].map((name) => ({ name, in: "query", required: true, schema: { type: "string" } })),
        requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        responses: { "204": { description: "Đã lưu." }, "403": { description: "Chữ ký sai hoặc hết hạn.", content: errContent } },
      },
    },
    "/api/v1/storage/local/get": {
      get: {
        operationId: "storage.local.get",
        summary: "Tải file từ kho lưu trữ local (chỉ dev).",
        description: "Link do `file.download.url` trả về, đã ký và hết hạn sau 5 phút.",
        tags: ["file"],
        parameters: ["key", "exp", "ct", "fn", "sig"].map((name) => ({ name, in: "query", required: true, schema: { type: "string" } })),
        responses: { "200": { description: "Nội dung file.", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }, "403": { description: "Chữ ký sai hoặc hết hạn.", content: errContent }, "404": { description: "Không có file.", content: errContent } },
      },
    },
  };
}

export function buildOpenApi(registry: Registry, serverUrl: string): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const op of registry.list()) {
    const p = `/api/v1${op.http.path.replace(/:(\w+)/g, "{$1}")}`;
    (paths[p] ??= {})[op.http.method.toLowerCase()] = buildOperation(op);
  }
  const infra = infraPaths() as Record<string, Record<string, Json>>;
  for (const [p, v] of Object.entries(infra)) paths[p] = { ...(paths[p] ?? {}), ...v };

  return {
    openapi: "3.1.0",
    info: {
      title: "SoE Hub API",
      version: "0.1.0",
      description:
        "API của SoE Hub, sinh tự động từ command/query registry. JSON `snake_case`. Lỗi: `{ error: { code, message, details } }`. " +
        "Lệnh ghi hỗ trợ header `Idempotency-Key` và `version` chống ghi đè. Xác thực: token `Authorization: Bearer soe_pat_…` " +
        "(token cá nhân, Admin đã duyệt) hoặc `soe_svc_…` (tài khoản hệ thống); trên web là cookie phiên `soe_session`, " +
        "mọi lệnh ghi bằng cookie phải gửi header `X-CSRF-Token` (giá trị của cookie `soe_csrf`).",
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "system", description: "Hệ thống, cài đặt, nhật ký." },
      { name: "file", description: "Lưu file và link ký số." },
      { name: "auth", description: "Đăng nhập, mã kích hoạt / đặt lại mật khẩu, phiên, token, tài khoản hệ thống." },
      { name: "org", description: "Org chart, vai trò, cây tổ chức, quyền bổ sung." },
      { name: "notification", description: "Thông báo trong ứng dụng." },
      { name: "guest", description: "Cấp dữ liệu cho Guest." },
      { name: "data", description: "Chuyển giao dữ liệu (Admin)." },
    ],
    paths,
    components: {
      schemas: { Error: structuredClone(errorSchema) },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Token cá nhân `soe_pat_…` (chờ Admin duyệt mới dùng được; quyền = giao của scope và quyền của chủ token) hoặc token tài khoản hệ thống `soe_svc_…`." },
        sessionCookie: { type: "apiKey", in: "cookie", name: "soe_session", description: "Phiên đăng nhập web (httpOnly). Hết hạn sau 7 ngày không hoạt động, tối đa 30 ngày." },
        csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token", description: "Bắt buộc cho lệnh ghi qua cookie: giá trị cookie `soe_csrf`." },
      },
    },
  };
}
