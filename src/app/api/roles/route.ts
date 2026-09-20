import { NextResponse } from "next/server";
import { ROLES } from "@/lib/permissions";

export async function GET() {
  return NextResponse.json(
    Object.values(ROLES).map((r) => ({ id: r.id, label: r.label, description: r.description }))
  );
}
