import { FileSpreadsheet, FileText, LoaderCircle, X } from "lucide-react";
import { formatBytes, partialNote, type DocAttachment } from "@/lib/documents";

const LABEL: Record<DocAttachment["type"], string> = { pdf: "PDF", docx: "Word", txt: "טקסט", md: "Markdown", csv: "CSV" };

// A compact file card: icon, name, size/type (or "reading…", or how much of it is used).
// In the composer it has a remove button; in a sent message it's read-only.
export default function DocChip({
  name,
  size,
  doc,
  onRemove,
}: {
  name: string;
  size: number;
  doc?: DocAttachment; // missing while the file is being read
  onRemove?: () => void;
}) {
  const Icon = doc?.type === "csv" ? FileSpreadsheet : FileText;
  const partial = doc && partialNote(doc);
  return (
    <div
      data-testid="doc-chip"
      data-status={doc ? "ready" : "parsing"}
      className="fade-in relative flex max-w-full min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface py-2 ps-2.5 pe-3"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-bubble text-muted">
        <Icon size={19} />
      </span>
      <span className="min-w-0">
        <span dir="auto" className="block truncate text-[14px] leading-snug font-medium">
          {name}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] leading-snug text-muted">
          {doc ? (
            <span>
              <span dir="ltr">{formatBytes(size)}</span> · {LABEL[doc.type]}
              {partial && <> · {partial}</>}
            </span>
          ) : (
            <span role="status" className="flex items-center gap-1.5">
              <LoaderCircle size={12} aria-hidden className="animate-spin" />
              קורא את המסמך…
            </span>
          )}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="הסרת המסמך"
          title="הסרה"
          className="press absolute -inset-s-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-fg text-bg shadow transition-transform"
        >
          <X size={14} strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </div>
  );
}
