import { NextResponse } from "next/server";
import { createUser, isValidNickname } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const nickname = (body as { nickname?: unknown })?.nickname;
  if (!isValidNickname(nickname)) {
    return NextResponse.json(
      { error: "invalid_nickname", hint: "2-20 Zeichen, Buchstaben/Zahlen/Bindestrich/Punkt/Leerzeichen" },
      { status: 400 }
    );
  }
  try {
    const u = createUser(nickname);
    return NextResponse.json(u, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "TAKEN") {
      return NextResponse.json({ error: "nickname_taken" }, { status: 409 });
    }
    if (msg === "INVALID_NICKNAME") {
      return NextResponse.json({ error: "invalid_nickname" }, { status: 400 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
