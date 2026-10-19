import { HistoryDiff } from "./documents/HistoryDiff";
import "./documents/documentHistory.css";
export function ConflictComparison(
  { left, right, labels = ["本地", "远端"] }: { left: string; right: string; labels?: [string, string] },
) {
  return (
    <div className="conflict-compare history-conflict-compare">
      <HistoryDiff left={left} right={right} labels={labels} contentLabels={labels} />
    </div>
  );
}
