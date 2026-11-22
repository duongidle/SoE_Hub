/**
 * Permission strings, roles and the role -> permission map (design module1 section 3).
 * A permission is `<domain>:<object>:<action>` (a few Stage 0 strings have two parts and are kept as they are).
 * Roles map to permission sets here, in code. There is no tool to create roles.
 */

export const ROLES = ["admin", "manager", "leader", "user", "guest"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  leader: "Leader",
  user: "User",
  guest: "Guest",
};

export const GUEST_PRESETS = ["sale", "data"] as const;
export type GuestPreset = (typeof GUEST_PRESETS)[number];
export const GUEST_PRESET_LABELS: Record<GuestPreset, string> = { sale: "Sale", data: "Data" };

export const USER_STATUSES = ["inactive", "active", "locked"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  inactive: "Chưa kích hoạt",
  active: "Đang hoạt động",
  locked: "Đã khoá",
};

/** Every permission string with a Vietnamese label. Module code may only use strings listed here. */
export const PERMISSIONS = {
  // Stage 0
  "system:whoami": "Xem tài khoản đang dùng",
  "system:setting:read": "Đọc cài đặt hệ thống",
  "system:setting:write": "Sửa cài đặt hệ thống",
  "system:audit:read": "Xem nhật ký hệ thống",
  "file:read": "Tải file",
  "file:write": "Tải file lên, xoá file",
  "docs:read": "Xem tài liệu API",
  "events:subscribe": "Nhận tín hiệu cập nhật (SSE)",
  // Module 1
  "auth:self": "Quản lý tài khoản của mình (mật khẩu, thiết bị, token)",
  "notification:read": "Xem thông báo của mình",
  "notification:manage": "Cài đặt thông báo và nhắc hẹn của mình",
  "notification:announce": "Gửi thông báo chung (Admin, Manager, Leader theo phạm vi)",
  "org:member:read": "Xem org chart",
  "org:member:write": "Sửa org chart (thêm, sửa, khoá người)",
  "org:role:elevated": "Gán vai trò Manager, Admin",
  "org:permission:grant": "Cấp quyền bổ sung",
  "guest:grant:manage": "Cấp dữ liệu cho Guest",
  "auth:token:approve": "Duyệt token cá nhân",
  "auth:session:manage": "Thu hồi phiên của người khác",
  "auth:service_account:manage": "Quản lý tài khoản hệ thống",
  "data:transfer": "Chuyển giao dữ liệu",
  // Business permissions used by later modules (declared now so roles are complete)
  "deal:deal:read": "Xem Quản lý Deal",
  "deal:deal:write": "Sửa deal",
  "deal:deal:assign": "Tạo và phân deal",
  "deal:policy:write": "Sửa chính sách com",
  "deal:period:lock": "Khoá kỳ",
  "deal:payment:write": "Lập lịch thanh toán, xác nhận tiền về, điều chỉnh com (Manager của cây)",
  "deal:snapshot:create": "Chụp snapshot",
  "deal:forecast:read": "Xem forecast (Manager của cây, Leader của team)",
  "deal:column:push": "Đẩy cột chung xuống Deals",
  "deal:template:manage": "Quản lý template Deals",
  "deal:team:export": "Xuất dữ liệu deal của team",
  "datahub:datahub:create": "Tạo datahub",
  "datahub:datahub:use": "Dùng datahub (của mình hoặc được chia sẻ)",
  "datahub:template:write": "Tạo và sửa bảng template Quản lý Deal (Manager cho cây, Leader cho team)",
  "form:form:create": "Tạo form",
  "form:response:submit": "Điền và gửi form (người điền)",
  "knowledge:article:read": "Đọc Knowledge",
  "knowledge:article:post": "Đăng bài Knowledge",
  "knowledge:article:review": "Duyệt Knowledge",
  "aihub:skill:read": "Đọc AI Hub",
  "aihub:skill:post": "Đăng skill AI Hub",
  "aihub:skill:review": "Duyệt AI Hub",
  "review:reviewer:choose": "Chọn người duyệt Knowledge / AI Hub",
  "onboarding:path:create": "Tạo lộ trình onboard",
  "onboarding:path:read": "Xem và làm lộ trình onboard của mình",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(s: string): s is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, s);
}

/** Every signed-in person, guests included (module1 section 3.4). */
const SIGNED_IN: Permission[] = ["system:whoami", "system:setting:read", "file:read", "file:write", "events:subscribe", "auth:self", "notification:read", "notification:manage", "form:response:submit"];
/** Every signed-in person except guests. */
const MEMBER: Permission[] = [...SIGNED_IN, "docs:read", "org:member:read", "knowledge:article:read", "aihub:skill:read", "datahub:datahub:use", "onboarding:path:read"];
/** Work every member role can do with their own data (module1 section 3.2). */
const OWN_WORK: Permission[] = ["deal:deal:read", "datahub:datahub:create", "form:form:create", "knowledge:article:post", "aihub:skill:post"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Admin runs the system and has NO business permissions, except reading Deals of every tree (read only).
  admin: [
    ...MEMBER,
    "notification:announce",
    "system:setting:write",
    "system:audit:read",
    "org:member:write",
    "org:role:elevated",
    "org:permission:grant",
    "auth:token:approve",
    "auth:session:manage",
    "auth:service_account:manage",
    "data:transfer",
    "deal:deal:read",
    "deal:template:manage",
    "review:reviewer:choose",
  ],
  manager: [
    ...MEMBER,
    ...OWN_WORK,
    "notification:announce",
    "org:member:write",
    "org:permission:grant",
    "guest:grant:manage",
    "deal:deal:write",
    "deal:deal:assign",
    "deal:policy:write",
    "deal:period:lock",
    "deal:payment:write",
    "deal:snapshot:create",
    "deal:forecast:read",
    "deal:column:push",
    "datahub:template:write",
    "review:reviewer:choose",
    "onboarding:path:create",
    // Every Manager reviews the shared library (design module8 1).
    "knowledge:article:review",
    "aihub:skill:review",
  ],
  leader: [...MEMBER, ...OWN_WORK, "notification:announce", "deal:forecast:read", "deal:column:push", "datahub:template:write", "onboarding:path:create"],
  user: [...MEMBER, ...OWN_WORK],
  // Guests get nothing beyond being signed in; the preset and data grants add the rest.
  guest: [...SIGNED_IN],
};

export const GUEST_PRESET_PERMISSIONS: Record<GuestPreset, Permission[]> = {
  sale: ["knowledge:article:read"],
  data: [],
};

/** Supplementary permissions (module1 section 3.3): who may grant each one, and to which roles. */
export interface SupplementaryPermission {
  permission: Permission;
  label: string;
  grantableBy: Role[];
  /** The target must hold at least one of these roles. */
  eligibleRoles: Role[];
}

export const SUPPLEMENTARY_PERMISSIONS: SupplementaryPermission[] = [
  { permission: "knowledge:article:review", label: "Duyệt Knowledge", grantableBy: ["admin", "manager"], eligibleRoles: ["manager", "leader", "user"] },
  { permission: "aihub:skill:review", label: "Duyệt AI Hub", grantableBy: ["admin", "manager"], eligibleRoles: ["manager", "leader", "user"] },
  { permission: "onboarding:path:create", label: "Tạo lộ trình onboard (cho User)", grantableBy: ["manager"], eligibleRoles: ["user"] },
  { permission: "deal:team:export", label: "Xuất dữ liệu deal của team (cho Leader)", grantableBy: ["manager"], eligibleRoles: ["leader"] },
];

/** Permissions a bearer token may never carry: account management. Onboarding is open to the connections of Leaders and Managers (design module9 10); the commands refuse a person who is only onboarded. */
export function isTokenAllowedPermission(p: string): boolean {
  return isPermission(p) && !p.startsWith("auth:");
}

/** Permissions a service account (external system) may be given. */
export const SERVICE_ACCOUNT_PERMISSIONS: Permission[] = [
  "system:whoami",
  "file:read",
  "file:write",
  "deal:deal:read",
  "deal:deal:write",
  "deal:deal:assign",
];

/** Permission set of a person from roles, guest preset and active supplementary permissions. */
export function permissionsFor(roles: readonly string[], guestPreset: string | null, extra: readonly string[] = []): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r as Role] ?? []) out.add(p);
  if (roles.includes("guest") && guestPreset) for (const p of GUEST_PRESET_PERMISSIONS[guestPreset as GuestPreset] ?? []) out.add(p);
  for (const p of extra) if (isPermission(p)) out.add(p);
  return out;
}

/** Highest role first; used to pick who receives a verification code (module1 section 6.4). */
export function primaryRole(roles: readonly string[]): Role | null {
  for (const r of ROLES) if (roles.includes(r)) return r;
  return null;
}
