# ADR 0003: Local-first storage with SQLite
Status: accepted
better-sqlite3 behind a `Repository` interface. No accounts. Supabase may implement the same interface later, off by default. Risk: native build on some machines (prebuilds expected for Node 20, unverified).
