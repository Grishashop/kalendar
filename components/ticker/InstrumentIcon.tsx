"use client";

import { useState } from "react";
import Image from "next/image";
import type { InstrumentKind } from "@/lib/ticker/instruments";
import { initials } from "@/lib/ticker/instruments";

const ICON_BG: Record<InstrumentKind, string> = {
  stock: "bg-sky-700",
  bond: "bg-purple-700",
  futures: "bg-orange-700",
  other: "bg-zinc-700",
};

interface InstrumentIconProps {
  kind: InstrumentKind;
  symbol: string;
  shortname: string;
  size?: "sm" | "md";
}

export function InstrumentIcon({ kind, symbol, shortname, size = "sm" }: InstrumentIconProps) {
  const dimension = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const pixels = size === "sm" ? 32 : 40;
  const [logoFailed, setLogoFailed] = useState(false);

  if (kind === "stock" && !logoFailed) {
    return (
      <Image
        src={`/logos/${encodeURIComponent(symbol)}.png`}
        alt=""
        width={pixels}
        height={pixels}
        unoptimized
        className={`${dimension} shrink-0 rounded-lg bg-zinc-800 object-cover`}
        onError={() => setLogoFailed(true)}
      />
    );
  }

  return (
    <div
      className={`flex ${dimension} shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white ${ICON_BG[kind]}`}
    >
      {initials(shortname || symbol)}
    </div>
  );
}
