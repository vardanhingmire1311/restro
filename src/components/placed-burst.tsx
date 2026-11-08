"use client";

import { Lottie } from "lottie-react";
import placed from "@/lottie/placed.json";

export function PlacedBurst() {
  return <Lottie src={placed} autoplay loop={false} className="h-48 w-48" />;
}
