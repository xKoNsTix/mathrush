import { NextResponse } from "next/server";
import { submitScore } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Payload {
  nickname?: unknown;
  token?: unknown;
  score?: unknown;
  solved?: unknown;
  bestCombo?: unknown;
}

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const nickname = typeof body.nickname === "string" ? body.nickname : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!nickname || !token) {
    return NextResponse.json({ error: "missing_auth" }, { status: 400 });
  }
  try {
    const r = submitScore({
      nickname,
      token,
      score: body.score as number,
      solved: body.solved as number,
      bestCombo: body.bestCombo as number,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (msg === "INVALID_PAYLOAD") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
