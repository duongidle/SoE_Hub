import { z } from "zod";
import type { EventDef } from "../../core/events";

export const authEvents: EventDef[] = [
  {
    name: "auth.code.requested",
    version: 1,
    description: "Có người xin mã kích hoạt / đặt lại mật khẩu. Tạo thông báo chứa mã cho người nhận (mã được mã hoá trong sự kiện).",
    schema: z.object({
      code_id: z.uuid(),
      purpose: z.enum(["activate", "reset"]),
      email: z.string(),
      full_name: z.string(),
      requested_at: z.string(),
      expires_at: z.string(),
      recipient_ids: z.array(z.uuid()),
      code_enc: z.string(),
    }),
    // No SSE signal: recipients are told through their notification (notification.notification.created).
    audience: () => null,
  },
  {
    name: "auth.token.requested",
    version: 1,
    description: "Một token cá nhân mới đang chờ Admin duyệt.",
    schema: z.object({ token_id: z.uuid(), user_id: z.uuid(), name: z.string() }),
    audience: (p: { user_id: string }) => ({ users: [p.user_id], permission: "auth:token:approve" }),
  },
  {
    name: "auth.token.decided",
    version: 1,
    description: "Token được duyệt, bị từ chối hoặc bị thu hồi.",
    schema: z.object({ token_id: z.uuid(), user_id: z.uuid(), status: z.enum(["active", "rejected", "revoked"]) }),
    audience: (p: { user_id: string }) => ({ users: [p.user_id], permission: "auth:token:approve" }),
  },
  {
    name: "org.member.changed",
    version: 1,
    description: "Một người trong org chart được thêm, sửa, khoá, mở khoá hoặc đổi quyền bổ sung.",
    schema: z.object({ user_id: z.uuid(), change: z.string() }),
    audience: (p: { user_id: string }) => ({ users: [p.user_id], scope: { kind: "org", ownerIds: [p.user_id] } }),
  },
];
