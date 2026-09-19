import { NextResponse } from "next/server";
import { getService } from "../../lib/service";
import { ImportRequestSchema } from "../../lib/types";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = ImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input. Check the username or PGN." }, { status: 400 });
  }
  const { id } = await getService().start(parsed.data);
  return NextResponse.json({ id }, { status: 202 });
}
