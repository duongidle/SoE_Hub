import { useQuery } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/form";
import { PeoplePicker } from "@/components/ui/people-picker";
import { PersonChip } from "@/components/ui/person";
import { Popover } from "@/components/ui/popover";
import { lookupPeople } from "@/lib/datahub/api";
import { disambiguate, type PersonInfo } from "@/lib/people";

/**
 * A field that holds a list of people as ids: a button opens the multi picker, the chosen people show as person chips (same-name ones
 * told apart by the start of the email) with a remove button. The names are fetched from the ids, so the caller keeps only ids.
 */
export function PeopleField({ label, value, onChange, teams, accept, excludeIds, tableId, testid }: { label: string; value: string[]; onChange: (ids: string[]) => void; teams?: boolean; accept?: (p: PersonInfo) => boolean; excludeIds?: readonly string[]; tableId?: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  const names = useQuery({ queryKey: ["people-ids", value.join(",")], queryFn: () => (value.length ? lookupPeople({ ids: value }) : Promise.resolve([] as PersonInfo[])), placeholderData: (prev) => prev });
  const people: PersonInfo[] = value.map((id) => names.data?.find((p) => p.id === id) ?? { id, full_name: names.isLoading ? "…" : id.slice(0, 6) });
  const shown = disambiguate(people);
  return (
    <div className="flex flex-col gap-2" data-testid={testid}>
      <Popover
        label={label}
        open={open}
        onOpenChange={setOpen}
        modal
        width="w-auto"
        trigger={
          <Button variant="secondary" aria-label={label} className="w-full justify-start sm:w-auto">
            <UserPlus size={16} aria-hidden /> {value.length ? `Đã chọn ${value.length} người, sửa danh sách` : "Chọn người"}
          </Button>
        }
      >
        <PeoplePicker
          value={people}
          teams={teams}
          accept={accept}
          tableId={tableId}
          excludeIds={excludeIds}
          onDone={(list) => {
            onChange(list.map((p) => p.id));
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </Popover>
      {people.length > 0 && (
        <ul aria-label={`${label}: đã chọn`} className="flex flex-wrap gap-1">
          {people.map((p) => (
            <li key={p.id} className="inline-flex max-w-full items-center rounded-full bg-muted pr-1">
              <PersonChip person={p} label={shown.get(p.id)} />
              <button type="button" aria-label={`Bỏ ${p.full_name}`} onClick={() => onChange(value.filter((x) => x !== p.id))} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-border"><X size={12} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
