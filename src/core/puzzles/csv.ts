import { PuzzleSchema, type Puzzle } from "../domain";

/** Column order of lichess_db_puzzle.csv, verified against https://database.lichess.org (puzzle format). */
export const PUZZLE_CSV_HEADER =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate";

export function isPuzzleCsvHeader(line: string): boolean {
  return line.trim() === PUZZLE_CSV_HEADER;
}

/**
 * Parses one data line. Returns undefined for malformed rows (wrong column count, quotes, failed
 * validation). The Lichess dump has no quoted fields: FEN, UCI moves and themes contain no commas.
 */
export function parsePuzzleLine(line: string): Puzzle | undefined {
  if (line.includes('"')) return undefined;
  const cols = line.replace(/\r$/, "").split(",");
  if (cols.length !== 11) return undefined;
  const [id, fen, moves, rating, , popularity, nbPlays, themes] = cols;
  if (id === undefined || fen === undefined || moves === undefined || themes === undefined) return undefined;
  const r = PuzzleSchema.safeParse({
    id,
    fen,
    moves: moves.split(" "),
    rating: Number(rating),
    popularity: Number(popularity),
    nbPlays: Number(nbPlays),
    themes: themes === "" ? [] : themes.split(" "),
  });
  return r.success ? r.data : undefined;
}
