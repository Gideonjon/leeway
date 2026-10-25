"use client";
import { useCallback, useEffect, useState } from "react";

/** Transfers this browser started. Kept locally only: Leeway has no accounts. */
export interface ActivityItem {
  id: string; // tracking code or deposit address
  kind: "ghost" | "swap";
  fromSymbol: string;
  fromChain: string;
  toSymbol: string;
  toChain: string;
  amount: string;
  createdAt: number;
}

const KEY = "leeway.activity";
const EVENT = "leeway:activity";

function read(): ActivityItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ActivityItem[];
  } catch {
    return [];
  }
}

export function addActivity(item: ActivityItem) {
  try {
    const list = [item, ...read().filter((i) => i.id !== item.id)].slice(0, 30);
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export function clearActivity() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export function useActivity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const refresh = useCallback(() => setItems(read()), []);
  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);
  return items;
}
