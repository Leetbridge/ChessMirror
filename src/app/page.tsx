import { ImportForm } from "./components/ImportForm";

export default function Home() {
  return (
    <>
      <h1>See the patterns in your chess</h1>
      <p className="lede">
        Import your games and get a short list of recurring habits, with the exact positions that suggest them,
        plus a practice plan. Results are hypotheses to check, not verdicts.
      </p>
      <ImportForm />
    </>
  );
}
