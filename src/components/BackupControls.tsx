// Export / import of the study backup (backup.ts): the dictionary, the review
// state of every card and the study settings in one file. Offered in the
// dictionary and the deck list alike — both hold data that lives only in this
// browser. Importing merges (see backup.ts), so no confirmation is needed.

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import { makeBackup, parseBackup } from "../backup";
import { importBackup, studySnapshot, useStudy } from "../study";

export function BackupControls() {
  const { saveError } = useStudy();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const say = (text: string) => setMsg((m) => ({ text, seq: m.seq + 1 }));
  useEffect(() => {
    if (!msg.text) return;
    const t = window.setTimeout(() => setMsg((m) => ({ ...m, text: "" })), 6000);
    return () => window.clearTimeout(t);
  }, [msg]);

  function exportFile() {
    const s = studySnapshot();
    const blob = new Blob([JSON.stringify(makeBackup(s.words, s.srs, s.settings, Date.now()))], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `murrnglish-study-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    say("Backup downloaded");
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    let text = "";
    try {
      text = await f.text();
    } catch {
      say("Could not read the file");
      return;
    }
    const b = parseBackup(text);
    if (!b) {
      say("Not a study backup (a book’s progress file goes into that book’s Progress window)");
      return;
    }
    const r = importBackup(b);
    say(
      `Imported: ${r.added} new word${r.added === 1 ? "" : "s"}, ${r.updated} updated, ${r.cards} card${r.cards === 1 ? "" : "s"} with newer reviews`,
    );
  }

  return (
    <div className="backup">
      {saveError && (
        <p className="lookupstatus warn">
          This browser refused to save the last change (storage full or blocked). Export a backup now.
        </p>
      )}
      <div className="modal-actions">
        <button className="themebtn" onClick={exportFile}>
          <Download size={14} aria-hidden /> Export backup
        </button>
        <button className="themebtn" onClick={() => fileRef.current?.click()}>
          <Upload size={14} aria-hidden /> Import backup
        </button>
      </div>
      <div className="modal-msg" role="status">
        {msg.text && (
          <span key={msg.seq} className="msgtext">
            {msg.text}
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pick} />
    </div>
  );
}
