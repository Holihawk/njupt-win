import { RagChat } from "../../components/rag-chat";
import { hasRagConfig } from "../../src/rag/index";

export const dynamic = "force-dynamic";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const rawQuestion = (await searchParams).q;
  const question = typeof rawQuestion === "string" ? rawQuestion.trim().slice(0, 3000) : "";
  return (
    <main className="ask-page">
      <RagChat enabled={hasRagConfig()} initialQuestion={question} workspace />
    </main>
  );
}
