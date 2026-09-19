# ADR 0002: Stockfish as an external UCI process
Status: accepted
Stockfish is GPL. We never bundle it; users install it and set `STOCKFISH_PATH`. The engine module talks UCI over stdio. Missing engine gives a clear error.
