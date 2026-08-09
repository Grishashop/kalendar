import { NextResponse } from "next/server";
import { loadContracts } from "@/lib/karman/contracts";

export async function GET(request: Request) {
  const secids = new URL(request.url).searchParams.get("secids") ?? "";
  const codes = secids
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  if (codes.length === 0) {
    return NextResponse.json({}, { status: 200 });
  }

  try {
    const contracts = await loadContracts(codes);
    return NextResponse.json(contracts);
  } catch (error) {
    if (error instanceof Error && error.message === "iss_unavailable") {
      // 503, а не 200 с пустым ответом: клиент должен понять, что проверка не выполнена.
      return NextResponse.json({ error: "iss_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "contracts_failed" }, { status: 500 });
  }
}
