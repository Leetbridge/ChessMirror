"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { startAnalysis } from "../lib/client";
import { ImportRequestSchema, type ImportRequest } from "../lib/types";

type Source = ImportRequest["source"];

const SOURCES: { value: Source; label: string }[] = [
  { value: "lichess", label: "Lichess" },
  { value: "chesscom", label: "chess.com" },
  { value: "pgn", label: "Paste PGN" },
];

export function buildRequest(source: Source, text: string): ImportRequest | string {
  const parsed = ImportRequestSchema.safeParse(
    source === "pgn" ? { source, pgn: text } : { source, username: text },
  );
  if (parsed.success) return parsed.data;
  return source === "pgn"
    ? "Paste at least one game in PGN format."
    : "Enter a valid username (letters, numbers, dashes and underscores).";
}

export function ImportForm() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("lichess");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const req = buildRequest(source, text);
    if (typeof req === "string") {
      setError(req);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await startAnalysis(req);
      router.push(`/analysis/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const isPgn = source === "pgn";
  return (
    <form onSubmit={onSubmit} noValidate aria-busy={busy}>
      <fieldset>
        <legend>Where are your games?</legend>
        <div className="radios">
          {SOURCES.map((s) => (
            <label key={s.value}>
              <input
                type="radio"
                name="source"
                value={s.value}
                checked={source === s.value}
                onChange={() => {
                  setSource(s.value);
                  setError(null);
                }}
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="input">{isPgn ? "PGN" : "Username"}</label>
        {isPgn ? (
          <textarea
            id="input"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "form-error" : undefined}
            placeholder={'[Event "Casual game"]\n1. e4 e5 2. Nf3 Nc6 *'}
          />
        ) : (
          <input
            id="input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "form-error" : undefined}
          />
        )}
      </div>
      {error && (
        <p id="form-error" className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Starting..." : "Analyze my games"}
      </button>
    </form>
  );
}
