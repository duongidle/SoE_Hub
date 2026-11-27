import { describe, expect, it } from "vitest";
import { disambiguate, initialsOf, statusLabel } from "../src/lib/people";

describe("disambiguate", () => {
  it("keeps the plain name when it is unique in the list", () => {
    const m = disambiguate([{ id: "1", full_name: "Lê An", email: "an@base.vn" }, { id: "2", full_name: "Trần Bình", email: null }]);
    expect(m.get("1")).toBe("Lê An");
    expect(m.get("2")).toBe("Trần Bình");
  });
  it("adds the start of the email to namesakes, ignoring case, spaces and repeated ids", () => {
    const m = disambiguate([
      { id: "1", full_name: "Nguyễn Văn A", email: "vana.nt@base.vn" },
      { id: "2", full_name: "nguyễn  văn a ", email: "vana.hp@base.vn" },
      { id: "1", full_name: "Nguyễn Văn A", email: "vana.nt@base.vn" },
      { id: "3", full_name: "Khác", email: "k@base.vn" },
    ]);
    expect(m.get("1")).toBe("Nguyễn Văn A (vana.nt)");
    expect(m.get("2")).toBe("nguyễn  văn a  (vana.hp)");
    expect(m.get("3")).toBe("Khác");
  });
  it("uses the whole email when even the start is the same, and the name when there is no email", () => {
    const m = disambiguate([
      { id: "1", full_name: "Hoa", email: "hoa@base.vn" },
      { id: "2", full_name: "Hoa", email: "hoa@khac.vn" },
      { id: "3", full_name: "Mai", email: null },
      { id: "4", full_name: "Mai", email: null },
    ]);
    expect(m.get("1")).toBe("Hoa (hoa@base.vn)");
    expect(m.get("2")).toBe("Hoa (hoa@khac.vn)");
    expect(m.get("3")).toBe("Mai");
    expect(m.get("4")).toBe("Mai");
  });
});

describe("person helpers", () => {
  it("initials and status", () => {
    expect(initialsOf("Nguyễn Văn An")).toBe("VA");
    expect(initialsOf("Hoa")).toBe("H");
    expect(initialsOf("")).toBe("");
    expect(statusLabel("active")).toBe("Đang làm");
    expect(statusLabel("locked")).toBe("Đã nghỉ");
    expect(statusLabel(undefined)).toBeNull();
  });
});
