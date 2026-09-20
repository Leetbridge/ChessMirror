import { readFileSync, statSync } from "node:fs";
import { MAX_PGN_CHARS } from "./types";

/** Byte cap for PGN files read by the CLI (2 MB). */
export const MAX_PGN_FILE_BYTES = 2_000_000;

/** Thrown with a fixed, user-safe message (never echoes OS error text or file contents). */
export class PgnFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PgnFileError";
  }
}

/** Read a PGN file: must be a regular file no larger than MAX_PGN_FILE_BYTES. */
export function readPgnFile(path: string): string {
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new PgnFileError("The PGN path is not a regular file.");
    if (st.size > MAX_PGN_FILE_BYTES) {
      throw new PgnFileError(`The PGN file is larger than ${MAX_PGN_FILE_BYTES / 1_000_000} MB.`);
    }
    const text = readFileSync(path, "utf8");
    if (text.length > MAX_PGN_CHARS) throw new PgnFileError("The PGN file is too large.");
    return text;
  } catch (e) {
    if (e instanceof PgnFileError) throw e;
    throw new PgnFileError("Could not read the PGN file. Check the path and permissions.");
  }
}
