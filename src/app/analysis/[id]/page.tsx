import { ProgressView } from "../../components/ProgressView";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1>Analysis</h1>
      <ProgressView id={id} />
    </>
  );
}
