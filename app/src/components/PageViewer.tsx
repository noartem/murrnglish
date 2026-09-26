// Left pane: original book page images for the active unit/exercise.

import { pageUrl } from "../data";

interface Props {
  pdfPages: number[];
  label: string;
}

export function PageViewer({ pdfPages, label }: Props) {
  return (
    <div className="pageviewer">
      <div className="pagelabel">{label}</div>
      {pdfPages.map((p) => (
        <img key={p} src={pageUrl(p)} alt={`Book page ${p}`} className="pageimg" />
      ))}
    </div>
  );
}
