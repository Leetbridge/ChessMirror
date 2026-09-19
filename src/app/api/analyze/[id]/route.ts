import { NextResponse } from "next/server";
import { getService } from "../../../lib/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getService().get(id);
  if (!job) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  return NextResponse.json(job);
}
