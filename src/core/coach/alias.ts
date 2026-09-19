import type { CoachAdvice } from "./advice";
import type { CoachContext } from "./context";

/**
 * Game ids (and urls) originate in untrusted PGN headers. The LLM only ever sees
 * opaque aliases ("game-1", ...); real ids are restored after validation.
 * The alias shape avoids SAN-like tokens so it never trips move validation.
 */
export interface AliasedContext {
  ctx: CoachContext;
  restore(advice: CoachAdvice): CoachAdvice;
}

const ALIAS_RE = /\bgame-(\d+)\b/g;

export function aliasContext(real: CoachContext): AliasedContext {
  const toAlias = new Map<string, string>();
  const toReal = new Map<string, string>();
  const register = (id: string): string => {
    let a = toAlias.get(id);
    if (!a) {
      a = `game-${toAlias.size + 1}`;
      toAlias.set(id, a);
      toReal.set(a, id);
    }
    return a;
  };
  for (const g of real.games) register(g.id);
  for (const m of real.moves) register(m.gameId);
  for (const f of real.findings) {
    if (f.status === "detected") for (const e of f.evidence) register(e.gameId);
  }

  // Detector-authored text may embed real ids; replace them so they do not reach the prompt.
  const scrub = (text: string): string => {
    let out = text;
    for (const [id, a] of toAlias) out = out.split(id).join(a);
    return out;
  };

  const ctx: CoachContext = {
    games: real.games.map((g) => {
      const { url: _url, ...rest } = g;
      void _url;
      return { ...rest, id: register(g.id) };
    }),
    moves: real.moves.map((m) => ({ ...m, gameId: register(m.gameId) })),
    findings: real.findings.map((f) =>
      f.status === "detected"
        ? {
            ...f,
            explanation: scrub(f.explanation),
            chessDrill: { ...f.chessDrill, description: scrub(f.chessDrill.description) },
            softSkillDrill: { ...f.softSkillDrill, description: scrub(f.softSkillDrill.description) },
            evidence: f.evidence.map((e) => ({
              gameId: register(e.gameId),
              ply: e.ply,
              ...(e.note ? { note: scrub(e.note) } : {}),
            })),
          }
        : f,
    ),
  };

  const unalias = (text: string): string => text.replace(ALIAS_RE, (m) => toReal.get(m) ?? m);

  return {
    ctx,
    restore: (advice) => ({
      summary: unalias(advice.summary),
      findings: advice.findings.map((fa) => ({
        ...fa,
        headline: unalias(fa.headline),
        explanation: unalias(fa.explanation),
        whatToDo: unalias(fa.whatToDo),
        citedRefs: fa.citedRefs.map((r) => ({ gameId: toReal.get(r.gameId) ?? r.gameId, ply: r.ply })),
      })),
    }),
  };
}
