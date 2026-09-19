import { NextResponse } from "next/server";
import { getService } from "../../lib/service";
import { ImportRequestSchema, MAX_BODY_BYTES, ServiceBusyError } from "../../lib/types";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return err("Request is too large.", 413);

  // Content-Length can be absent or wrong, so also check the actual size.
  let text: string;
  try {
    text = await req.text();
  } catch {
    return err("Could not read the request body.", 400);
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return err("Request is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return err("Request body must be JSON.", 400);
  }
  const parsed = ImportRequestSchema.safeParse(body);
  if (!parsed.success) return err("Invalid input. Check the username, or paste at most 200 games in PGN.", 400);

  try {
    const { id } = await getService().start(parsed.data);
    return NextResponse.json({ id }, { status: 202 });
  } catch (e) {
    if (e instanceof ServiceBusyError) return err(e.message, 429);
    return err("Could not start the analysis.", 500);
  }
}
