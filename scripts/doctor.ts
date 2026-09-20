/**
 * Check that this machine is ready to run chessmirror.
 *
 *   npm run doctor
 *
 * Exits with code 1 only if a required check fails (Node version, Stockfish).
 */
import { formatDoctor, realDoctorDeps, runDoctor } from "../src/app/lib/doctor";

async function main(): Promise<number> {
  const results = await runDoctor(realDoctorDeps(process.env));
  console.log(formatDoctor(results));
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

main().then((code) => process.exit(code));
