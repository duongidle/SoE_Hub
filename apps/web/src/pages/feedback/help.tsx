import { useNavigate } from "@tanstack/react-router";
import { Bot, CircleHelp, MessageSquarePlus, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { Menu, MenuItem } from "@/components/ui/dropdown";
import { SendFeedbackModal } from "./send";

/** The "?" button of the top bar, next to the bell (design module11 1): send feedback, my feedback, the guide to connect AI. */
export function HelpButton() {
  const nav = useNavigate();
  const [sending, setSending] = useState(false);
  return (
    <>
      <Menu
        trigger={
          <button type="button" aria-label="Trợ giúp và góp ý" className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
            <CircleHelp size={18} aria-hidden />
          </button>
        }
      >
        <MenuItem onSelect={() => setSending(true)}><MessageSquarePlus size={16} aria-hidden className="text-muted-foreground" /> Gửi góp ý</MenuItem>
        <MenuItem onSelect={() => void nav({ to: "/gop-y" })}><MessagesSquare size={16} aria-hidden className="text-muted-foreground" /> Góp ý của tôi</MenuItem>
        <MenuItem onSelect={() => void nav({ to: "/tai-khoan/token" })}><Bot size={16} aria-hidden className="text-muted-foreground" /> Hướng dẫn kết nối AI</MenuItem>
      </Menu>
      {sending && <SendFeedbackModal onClose={() => setSending(false)} />}
    </>
  );
}
