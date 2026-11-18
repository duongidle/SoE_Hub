/**
 * Standard error codes. Codes are stable: clients (web, API users, AI) branch on `code`, never on `message`.
 * Every code maps to one HTTP status. Add new codes here only; never inline a code string elsewhere.
 */
export const ERROR_CODES = {
  validation_error: { status: 400, description: "Dữ liệu gửi lên không hợp lệ." },
  invalid_filter: { status: 400, description: "Bộ lọc, sắp xếp hoặc con trỏ phân trang không hợp lệ." },
  idempotency_key_invalid: { status: 400, description: "Header Idempotency-Key không hợp lệ." },
  unauthenticated: { status: 401, description: "Chưa đăng nhập hoặc chưa xác định được người dùng." },
  forbidden: { status: 403, description: "Không có quyền thực hiện thao tác này." },
  ai_not_allowed: { status: 403, description: "Thao tác này không cho phép AI gọi." },
  not_found: { status: 404, description: "Không tìm thấy đối tượng." },
  conflict: { status: 409, description: "Phiên bản đã cũ: bản ghi đã bị người khác sửa. Tải lại rồi sửa tiếp." },
  idempotency_key_reuse: { status: 422, description: "Idempotency-Key đã dùng cho một yêu cầu khác." },
  period_locked: { status: 423, description: "Kỳ đã khoá, không ghi được vào dòng thuộc kỳ này." },
  payload_too_large: { status: 413, description: "Dữ liệu hoặc file vượt giới hạn dung lượng." },
  unsupported_media_type: { status: 415, description: "Loại file hoặc loại nội dung không được chấp nhận." },
  quota_exceeded: { status: 422, description: "Vượt hạn mức lưu trữ." },
  rate_limited: { status: 429, description: "Gọi quá nhanh, thử lại sau." },
  internal_error: { status: 500, description: "Lỗi hệ thống." },
  unavailable: { status: 503, description: "Hệ thống tạm thời chưa sẵn sàng." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_CODES[code].description);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  toBody(requestId?: string): ErrorBody {
    const error: ErrorBody["error"] = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    if (requestId) error.request_id = requestId;
    return { error };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
