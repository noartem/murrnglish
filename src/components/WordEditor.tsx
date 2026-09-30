// The dictionary entry editor: one modal for adding a word (typed in the
// dictionary, or picked from an exercise or a rule with PickWord) and for
// editing a saved one. Adding looks the word up at once (lookup.ts) and fills
// in what came back — the translation from the first sense, with every other
// candidate a click away — and the learner can change all of it before
// saving. Offline, or when every source fails, the word is still saved with
// what the learner typed; "Look up" can be run again later.
//
// Any view opens it through openWordEditor(); App renders the one host.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, LoaderCircle, Search, Trash2, Volume2, X } from "lucide-react";
import type { LookupResult } from "../lookup";
import { OfflineError, cacheAudio, forgetAudio, lookupWord, speak, suggestTranslation } from "../lookup";
import { deleteWord, resumeSuspended, saveWord, studySnapshot, useStudy } from "../study";
import type { Word } from "../words";
import { headwordKey, newWordId } from "../words";

export interface WordRequest {
  /** a word to add (looked up at once) */
  word?: string;
  /** a saved entry to edit */
  id?: string;
  /** the sentence it was picked from */
  context?: string;
  source?: Word["source"];
}

let listener: ((r: WordRequest) => void) | null = null;

export function openWordEditor(r: WordRequest): void {
  listener?.(r);
}

/** Mounted once (App): shows the editor whenever a view asks for it. */
export function WordEditorHost() {
  const [req, setReq] = useState<(WordRequest & { seq: number }) | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seq = 0;
    listener = (r) => {
      setReq({ ...r, seq: ++seq });
      setOpen(true);
    };
    return () => {
      listener = null;
    };
  }, []);
  // exit: hold the card while modal-out plays (as ProgressModal does)
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 150);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!shown || !req) return null;
  return <WordEditor key={req.seq} req={req} closing={!open} onClose={() => setOpen(false)} />;
}

function draftFor(req: WordRequest): { draft: Word; existing: boolean } {
  const words = studySnapshot().words;
  const byId = req.id ? words.find((w) => w.id === req.id) : undefined;
  const byKey = !byId && req.word ? words.find((w) => headwordKey(w.word) === headwordKey(req.word!)) : undefined;
  const found = byId ?? byKey;
  if (found) return { draft: { ...found }, existing: true };
  const now = Date.now();
  return {
    draft: {
      id: newWordId(),
      word: (req.word ?? "").trim(),
      translation: "",
      notes: "",
      reverse: true,
      added: now,
      updated: now,
      ...(req.context ? { context: req.context } : {}),
      ...(req.source ? { source: req.source } : {}),
    },
    existing: false,
  };
}

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; failed: string[]; empty: boolean }
  | { kind: "offline" }
  | { kind: "error" };

function WordEditor({ req, closing, onClose }: { req: WordRequest; closing: boolean; onClose: () => void }) {
  const [{ draft: initial, existing }] = useState(() => draftFor(req));
  const [w, setW] = useState<Word>(initial);
  const [found, setFound] = useState<LookupResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const transRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Word>) => setW((x) => ({ ...x, ...patch }));
  const { srs } = useStudy();
  const suspended = existing && srs.suspended.some((id) => id.startsWith(`w:${w.id}:`));

  async function lookup(word = w.word) {
    const q = word.trim();
    if (!q) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setStatus({ kind: "busy" });
    try {
      const r = await lookupWord(q, ctl.signal);
      if (ctl.signal.aborted) return;
      setFound(r);
      const empty = !r.senses.length && !r.groups.length && !r.machine.length;
      setStatus({ kind: "done", failed: r.failed, empty });
      setW((x) => ({
        ...x,
        ipa: r.ipa ?? x.ipa,
        audio: r.audio ?? x.audio,
        senses: r.senses.length ? r.senses : x.senses,
        alternatives: [...new Set([...r.groups.flatMap((g) => g.words), ...r.machine])].slice(0, 16),
        // a translation the learner already has stays theirs
        translation: x.translation.trim() ? x.translation : suggestTranslation(r),
      }));
      window.setTimeout(() => transRef.current?.focus(), 0);
    } catch (e) {
      if (ctl.signal.aborted) return;
      setStatus(e instanceof OfflineError ? { kind: "offline" } : { kind: "error" });
    }
  }

  // a new word is looked up as soon as the editor opens
  useEffect(() => {
    if (!existing && w.word) void lookup();
    else if (!w.word) wordRef.current?.focus();
    else transRef.current?.focus();
    return () => abort.current?.abort();
    // once, on open
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleTranslation = (t: string) => {
    const parts = w.translation
      .split(/\s*[,;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = parts.includes(t) ? parts.filter((p) => p !== t) : [...parts, t];
    set({ translation: next.join(", ") });
  };

  const canSave = w.word.trim().length > 0;
  function save() {
    if (!canSave) return;
    const clean: Word = {
      ...w,
      word: w.word.trim(),
      translation: w.translation.trim(),
      notes: w.notes.trim(),
      updated: Date.now(),
    };
    saveWord(clean);
    if (clean.audio) void cacheAudio(clean.audio);
    onClose();
  }

  function remove() {
    deleteWord(w.id);
    if (w.audio) void forgetAudio(w.audio);
    onClose();
  }

  const onFormKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  const picked = new Set(w.translation.split(/\s*[,;]\s*/).map((s) => s.trim()));
  const groups = found?.groups ?? [];
  const machine = found?.machine.filter((m) => !groups.some((g) => g.words.includes(m))) ?? [];
  // an entry opened for editing offers what its last lookup stored
  const storedOnly = !found && (w.alternatives?.length ?? 0) > 0;

  return (
    <div className={"modal-overlay" + (closing ? " closing" : "")} onClick={onClose}>
      <div
        className={"modal wordmodal" + (closing ? " closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit word" : "Add a word"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onFormKey}
      >
        <div className="modal-head">
          <h2>{existing ? "Edit word" : "Add to dictionary"}</h2>
          <button className="themebtn" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="wordform">
          <div className="wordline">
            <input
              ref={wordRef}
              className="wfull wordinput"
              value={w.word}
              onChange={(e) => set({ word: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  void lookup();
                }
              }}
              placeholder="English word or phrase"
              aria-label="Word"
              spellCheck={false}
              autoCapitalize="off"
            />
            <button
              type="button"
              className="themebtn labelled"
              onClick={() => void lookup()}
              disabled={!w.word.trim() || status.kind === "busy"}
            >
              {status.kind === "busy" ? (
                <LoaderCircle size={15} className="spin" aria-hidden />
              ) : (
                <Search size={15} aria-hidden />
              )}
              Look up
            </button>
          </div>
          <div className="wordmeta">
            {w.ipa && <span className="ipa">{w.ipa}</span>}
            {w.word.trim() && (
              <button
                type="button"
                className="linkbtn"
                onClick={() => void speak(w.word, w.audio)}
                title={w.audio ? "Play the recording" : "Say it (speech synthesis)"}
              >
                <Volume2 size={15} aria-hidden /> Listen
              </button>
            )}
            <LookupStatus status={status} />
          </div>

          <label className="fieldlabel" htmlFor="word-translation">
            Translation
          </label>
          <input
            id="word-translation"
            ref={transRef}
            className="wfull"
            value={w.translation}
            onChange={(e) => set({ translation: e.target.value })}
            placeholder="перевод"
            lang="ru"
          />
          {groups.length > 0 && (
            <div className="transgroups">
              {groups.slice(0, 8).map((g, i) => (
                <div key={i} className="transgroup">
                  <span className="transgloss">
                    {g.pos && <em>{g.pos.toLowerCase()}</em>} {g.gloss}
                  </span>
                  <span className="transchips">
                    {g.words.map((t) => (
                      <TransChip key={t} t={t} on={picked.has(t)} onToggle={toggleTranslation} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {(machine.length > 0 || storedOnly) && (
            <div className="transgroup">
              <span className="transgloss">{storedOnly ? "found before" : "machine translation"}</span>
              <span className="transchips">
                {(storedOnly ? w.alternatives! : machine).map((t) => (
                  <TransChip key={t} t={t} on={picked.has(t)} onToggle={toggleTranslation} />
                ))}
              </span>
            </div>
          )}

          {w.senses && w.senses.length > 0 && (
            <details className="senses" open={!existing}>
              <summary>Definitions</summary>
              {w.senses.map((s, i) => (
                <div key={i} className="sense">
                  <em className="pos">{s.pos}</em>
                  <ol>
                    {s.defs.map((d, j) => (
                      <li key={j}>
                        {d.def}
                        {d.example && <span className="senseex">{d.example}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </details>
          )}

          {w.context && (
            <p className="wordcontext">
              <span className="fieldlabel">From</span> {w.context}
            </p>
          )}

          <label className="fieldlabel" htmlFor="word-notes">
            Notes
          </label>
          <textarea
            id="word-notes"
            className="wfull"
            rows={2}
            value={w.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="an example of your own, a hint…"
          />
          <label className="modal-opt">
            <input type="checkbox" checked={w.reverse} onChange={(e) => set({ reverse: e.target.checked })} />
            Also a card from the translation back to the word
          </label>
          {suspended && (
            <p className="modal-opt">
              Its cards are suspended.
              <button
                type="button"
                className="linkbtn"
                onClick={() => resumeSuspended((id) => id.startsWith(`w:${w.id}:`))}
              >
                Resume them
              </button>
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button className="themebtn primary" onClick={save} disabled={!canSave} title="Save — Ctrl+Enter">
            <Check size={14} aria-hidden /> {existing ? "Save" : "Add"}
          </button>
          <button className="themebtn" onClick={onClose}>
            Cancel
          </button>
          {existing && (
            <button className="themebtn danger" onClick={remove}>
              <Trash2 size={14} aria-hidden /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TransChip({ t, on, onToggle }: { t: string; on: boolean; onToggle: (t: string) => void }) {
  return (
    <button type="button" className={"chip transchip" + (on ? " on" : "")} aria-pressed={on} onClick={() => onToggle(t)} lang="ru">
      {t}
    </button>
  );
}

function LookupStatus({ status }: { status: Status }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "busy":
      return <span className="lookupstatus">Looking up…</span>;
    case "offline":
      return (
        <span className="lookupstatus warn">Offline — type the translation yourself, look it up again later.</span>
      );
    case "error":
      return <span className="lookupstatus warn">The lookup failed — type the translation yourself.</span>;
    case "done":
      if (status.empty)
        return (
          <span className="lookupstatus warn">
            {status.failed.length ? `No answer from ${status.failed.join(", ")}.` : "Nothing found."} Type the
            translation yourself.
          </span>
        );
      return status.failed.length ? (
        <span className="lookupstatus">No answer from {status.failed.join(", ")}.</span>
      ) : null;
  }
}
