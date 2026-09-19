import type { Game, GameSourceId } from "../domain";

export interface GameQuery {
  username: string;
  /** Only games played at or after this ISO 8601 date-time. */
  since?: string;
  /** Upper bound on the number of games returned. */
  max?: number;
}

/** A place games come from (Lichess, chess.com, PGN text). */
export interface GameSource {
  readonly id: GameSourceId;
  fetchGames(query: GameQuery): Promise<Game[]>;
}
