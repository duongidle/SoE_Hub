import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, Modal, errorMessage } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/states";
import { formatCount } from "@soe/shared";
import { columnTypes, deleteColumn, dhKeys, restoreColumn } from "@/lib/datahub/api";
import type { Column, Level, TableDetail } from "@/lib/datahub/types";

/** Delete a column into the trash and offer "Hoàn tác" (restoring it brings its values back). */
export function useColumnDelete(table: TableDetail) {
  const qc = useQueryClient();
  return async (col: Column) => {
    try {
      await deleteColumn(table.id, col.id);
      await qc.invalidateQueries({ queryKey: dhKeys.table(table.id) });
      notify.ok(`Đã xoá cột "${col.name}"`, {
        label: "Hoàn tác",
        onClick: () =>
          void restoreColumn(table.id, col.id)
            .then(() => qc.invalidateQueries({ queryKey: dhKeys.table(table.id) }))
            .then(() => notify.ok(`Đã khôi phục cột "${col.name}"`))
            .catch((e) => notify.error(`Không khôi phục được cột: ${errorMessage(e)}`)),
      });
    } catch (e) {
      notify.error(`Không xoá được cột: ${errorMessage(e)}`);
    }
  };
}

/** The columns of the table as a list: who may change them sees "Sửa" and "Xoá" and "Thêm cột"; everyone else sees the list and why it is locked. */
export function ColumnManager({ table, level, onAdd, onEdit, onDelete, onClose }: { table: TableDetail; level: Level; onAdd: () => void; onEdit: (c: Column) => void; onDelete: (c: Column) => void; onClose: () => void }) {
  const owner = level === "owner";
  const typesQ = useQuery({ queryKey: ["dh-column-types"], queryFn: columnTypes, staleTime: Infinity });
  const label = (t: string) => typesQ.data?.find((x) => x.type === t)?.label ?? t;
  const full = table.columns.length >= table.max_columns;
  return (
    <Modal title="Cột của bảng" open onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">{table.columns.length} / {table.max_columns} cột</p>
          {owner && <Button onClick={onAdd} disabled={full}><Plus size={16} aria-hidden /> Thêm cột</Button>}
        </div>
        {owner && full && <p role="status" className="rounded-md bg-warn/15 px-3 py-2 text-sm">Bảng đã đủ {formatCount(table.max_columns, "cột")}. Xoá bớt cột hoặc nhờ Admin nâng giới hạn.</p>}
        {!owner && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Lock size={16} aria-hidden className="shrink-0" />
            <span>Chỉ chủ datahub được thêm, sửa hay xoá cột. Bạn thấy giá trị của cột công thức nhưng không thấy công thức.</span>
          </p>
        )}
        {table.columns.length === 0 ? (
          <EmptyState title="Bảng chưa có cột" hint={owner ? "Thêm cột đầu tiên để bắt đầu nhập dữ liệu." : "Chủ datahub chưa thêm cột nào."} action={owner ? <Button onClick={onAdd}><Plus size={16} aria-hidden /> Thêm cột đầu tiên</Button> : undefined} />
        ) : (
          <ul aria-label="Danh sách cột" className="flex flex-col divide-y divide-border rounded-md border border-border">
            {table.columns.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge>{label(c.type)}</Badge>
                    {c.required && <span>Bắt buộc</span>}
                    {c.unique && <span>Không trùng</span>}
                  </span>
                  {c.description && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{c.description}</span>}
                </div>
                {owner && (
                  <span className="flex shrink-0 gap-1">
                    <Tip label="Sửa cột"><Button variant="ghost" aria-label={`Sửa cột ${c.name}`} onClick={() => onEdit(c)} className="!px-2"><Pencil size={16} aria-hidden /></Button></Tip>
                    <Tip label="Xoá cột"><Button variant="ghost" aria-label={`Xoá cột ${c.name}`} onClick={() => onDelete(c)} className="!px-2 !text-bad"><Trash2 size={16} aria-hidden /></Button></Tip>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
