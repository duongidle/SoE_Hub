import type { ApiClient } from "./seed";

/** Datahub data for the browser tests, made through the API (the people are made by `seedPeople`). */

export interface LeadFixture {
  datahubId: string;
  leadId: string;
  customerId: string;
  keys: Record<string, string>;
  rowIds: string[];
}

export async function seedLead(owner: ApiClient, name: string, opts: { people: { id: string; name: string }[] }): Promise<LeadFixture> {
  const dh = await owner.call<{ id: string }>("POST", "/datahubs", { name });
  const customer = await owner.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Khách hàng" });
  await owner.call("POST", `/tables/${customer.id}/columns`, { name: "Tên khách", type: "text" });
  const lead = await owner.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Lead" });
  const col = (body: object) => owner.call<{ key: string }>("POST", `/tables/${lead.id}/columns`, body);
  const keys: Record<string, string> = {};
  const defs: [string, string, object?][] = [
    ["Tên lead", "text"],
    ["Doanh thu", "currency"],
    ["Tỉ lệ chốt", "percent"],
    ["Ngày nhận", "date"],
    ["Đã gọi", "checkbox"],
    ["Mức quan tâm", "rating"],
    ["Giai đoạn", "single_select", { options: [{ name: "Mới", color: "blue" }, { name: "Đang chăm", color: "orange" }, { name: "Chốt", color: "green" }] }],
    ["Nguồn", "multi_select", { options: [{ name: "Facebook" }, { name: "Giới thiệu" }, { name: "Sự kiện" }] }],
    ["Phụ trách", "user"],
    ["Ghi chú", "long_text"],
    ["Số lượng", "number", { precision: 0 }],
    ["Gấp đôi", "formula", { formula: "=[Doanh thu]*2" }],
    ["Đơn giá", "formula", { formula: "=[Doanh thu]/[Số lượng]" }],
    ["Mã dòng", "row_id"],
  ];
  for (const [n, type, config] of defs) {
    const c = await col(type === "formula" ? { name: n, type, config } : { name: n, type, ...(config ? { config } : {}) });
    keys[n] = c.key;
  }
  const rowIds: string[] = [];
  const first = await owner.call<{ id: string }>("POST", `/tables/${lead.id}/rows`, {
    data: { "Tên lead": "Đặng Thị Ngọc Hân", "Doanh thu": 156_000_000, "Tỉ lệ chốt": 0.125, "Ngày nhận": "2026-11-18", "Đã gọi": true, "Mức quan tâm": 3, "Giai đoạn": "Mới", Nguồn: ["Facebook", "Sự kiện"], "Phụ trách": opts.people[0]?.id, "Số lượng": 0 },
  });
  rowIds.push(first.id);
  const second = await owner.call<{ id: string }>("POST", `/tables/${lead.id}/rows`, { data: { "Tên lead": "Vy", "Doanh thu": 12_345_678_900, "Số lượng": 3, "Ngày nhận": "2026-11-19" } });
  rowIds.push(second.id);
  const third = await owner.call<{ id: string }>("POST", `/tables/${lead.id}/rows`, { data: { "Tên lead": "<b>Công ty</b> & Co &amp; Thuận Phát", "Doanh thu": -5000, "Ghi chú": "dòng 1\ndòng 2" } });
  rowIds.push(third.id);
  return { datahubId: dh.id, leadId: lead.id, customerId: customer.id, keys, rowIds };
}

/** Adds many rows quickly (500 per call), for the 10.000-row checks. */
export async function seedMany(owner: ApiClient, tableId: string, count: number, make: (i: number) => Record<string, unknown>): Promise<void> {
  for (let i = 0; i < count; i += 500) {
    const ops = Array.from({ length: Math.min(500, count - i) }, (_, k) => ({ op: "create", data: make(i + k) }));
    await owner.call("POST", `/tables/${tableId}/rows/batch`, { ops });
  }
}
