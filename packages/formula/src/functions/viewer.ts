import type { FnDef } from "../context";
import { err, FError, isArray, materialize, toText, type Scalar, type Value } from "../types";

const scalarOf = (v: Value): Scalar => {
  const x = materialize(v);
  if (isArray(x)) throw err.value("Cần một giá trị, nhưng nhận một danh sách.");
  if (x instanceof FError) throw x;
  return x as Scalar;
};

/** Viewer functions (design module2 section 6.2): the answer depends on who reads the value. */
export const viewerFns: FnDef[] = [
  {
    name: "ME", group: "Người xem", syntax: "ME()", description: "Người đang xem: chủ bảng ở lượt của chủ, từng thành viên ở lượt của họ. Cột dùng hàm này có giá trị riêng cho mỗi người.",
    example: "ME()", exampleResult: "id của người xem", min: 0, max: 0, returns: "text",
    impl: (_a, c) => {
      const me = c.me?.();
      if (!me) throw err.value("ME() chỉ dùng trong cột công thức của bảng.");
      return me;
    },
  },
  {
    name: "ISME", group: "Người xem", syntax: "ISME(ô_người_dùng)", description: "Đúng khi người đang xem nằm trong ô Người dùng (một người hoặc danh sách người).",
    example: "ISME([Người tham gia])", exampleResult: "TRUE", min: 1, max: 1, returns: "boolean",
    impl: (a, c) => {
      const me = c.me?.();
      if (!me) throw err.value("ISME() chỉ dùng trong cột công thức của bảng.");
      const t = scalarOf(a[0]!);
      if (t === null || t === "") return false;
      const mine = me.toLowerCase();
      return toText(t).split(",").some((x) => x.trim().toLowerCase() === mine);
    },
  },
  {
    name: "ATTR", group: "Người xem", syntax: "ATTR(ô_người_dùng, người, \"tên_thuộc_tính\")",
    description: "Thuộc tính của một người trong ô Người dùng có thuộc tính (tên thuộc tính khớp nhãn hoặc mã). Người không có trong ô thì trống. Đối số đầu phải là một cột của chính bảng này.",
    example: "ATTR([Người tham gia], ME(), \"% com\")", exampleResult: "0,5", min: 3, max: 3, returns: "mixed",
    lazy: (nodes, ev, c) => {
      const first = nodes[0]!;
      if (first.t !== "key" || first.table !== null) throw err.value("Đối số đầu của ATTR phải là một cột Người dùng của chính bảng này.");
      if (!c.attr) throw err.value("ATTR() chỉ dùng trong cột công thức của bảng.");
      const person = scalarOf(ev(nodes[1]!));
      const name = scalarOf(ev(nodes[2]!));
      if (person === null || person === "") return null;
      return c.attr(first.key, toText(person), toText(name));
    },
  },
];
