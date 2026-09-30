import { Button } from "./button";
import { Copy, Trash2 } from "lucide-react";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/desktop";

interface TranscriptionItemProps {
  item: TranscriptionItemType;
  index: number;
  total: number;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
}

export default function TranscriptionItem({
  item,
  index,
  total,
  onCopy,
  onDelete,
}: TranscriptionItemProps) {
  const timestampSource = item.timestamp.endsWith("Z") ? item.timestamp : `${item.timestamp}Z`;
  const timestampDate = new Date(timestampSource);
  const formattedTimestamp = Number.isNaN(timestampDate.getTime())
    ? item.timestamp
    : timestampDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <div className="group flex items-start gap-3 rounded-lg bg-neutral-50 px-3 py-2.5 transition-colors hover:bg-neutral-100/80">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] leading-4 text-neutral-500">
          <span className="font-medium text-neutral-700">#{total - index}</span>
          <span className="h-3 w-px bg-neutral-300" />
          <span>{formattedTimestamp}</span>
        </div>
        <p className="brand-body mt-1 break-words text-left text-[13px] text-neutral-800">
          {item.text}
        </p>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onCopy(item.text)}
          className="h-7 w-7 text-neutral-400 hover:text-neutral-900"
          aria-label="Copy transcription"
        >
          <Copy size={13} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onDelete(item.id)}
          className="h-7 w-7 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          aria-label="Delete transcription"
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </div>
  );
}
