import { describe, expect, it } from "vitest";
import { updatedText } from "../src/lib/datahub/card-text";

describe("updatedText (câu \"cập nhật\" trên thẻ datahub)", () => {
  const now = new Date("2026-11-28T05:00:00Z");
  it("vừa xong, phút, giờ, ngày", () => {
    expect(updatedText("2026-11-28T04:59:40Z", now)).toBe("Cập nhật vừa xong");
    expect(updatedText("2026-11-28T04:55:00Z", now)).toBe("Cập nhật 5 phút trước");
    expect(updatedText("2026-11-28T02:00:00Z", now)).toBe("Cập nhật 3 giờ trước");
    expect(updatedText("2026-11-25T05:00:00Z", now)).toBe("Cập nhật 3 ngày trước");
  });
  it("quá 7 ngày thì ghi ngày", () => {
    expect(updatedText("2026-11-01T05:00:00Z", now)).toMatch(/^Cập nhật ngày 01\/11\/2026/);
  });
  it("không có ngày thì rỗng", () => {
    expect(updatedText(null)).toBe("");
  });
});
