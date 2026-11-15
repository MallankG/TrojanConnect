"use client";

import { useSyncExternalStore } from "react";
import type { Db, DemoUser, Role } from "../types";
import { DB_VERSION, EMPTY_DB, USERS, seed } from "./seed";

/**
 * The mock backend's storage. One JSON document in localStorage, shared by
 * every tab through BroadcastChannel, so a reviewer approving in one window
 * updates the club representative's window at once. This stands in for
 * Supabase Postgres plus Realtime.
 */

const KEY = "tc-db";
const ROLE_KEY = "tc-role";

let db: Db | null = null;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function read(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    // Unreadable storage falls through to a fresh seed.
  }
  const fresh = seed();
  write(fresh);
  return fresh;
}

function write(next: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the session still works from memory.
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function connect() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(KEY);
  channel.onmessage = () => {
    db = read();
    emit();
  };
}

export function getDb(): Db {
  if (typeof window === "undefined") return EMPTY_DB;
  if (!db) {
    db = read();
    connect();
  }
  return db;
}

/** Apply a change to a copy of the database, then persist and broadcast it. */
export function mutate(fn: (draft: Db) => void) {
  const next = structuredClone(getDb());
  fn(next);
  db = next;
  write(next);
  emit();
  channel?.postMessage("changed");
}

export function resetDb() {
  db = seed();
  write(db);
  emit();
  channel?.postMessage("changed");
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Read the database reactively. Returns the empty database during server render. */
export function useDb(): Db {
  return useSyncExternalStore(subscribe, getDb, () => EMPTY_DB);
}

// ---- Demo identity ---------------------------------------------------------
// Kept per tab (sessionStorage) so two windows can hold two different roles.

function readRole(): Role | null {
  try {
    const value = sessionStorage.getItem(ROLE_KEY);
    return USERS.some((u) => u.role === value) ? (value as Role) : null;
  } catch {
    return null;
  }
}

export function setRole(role: Role | null) {
  try {
    if (role) sessionStorage.setItem(ROLE_KEY, role);
    else sessionStorage.removeItem(ROLE_KEY);
  } catch {
    // Ignored: the picker simply shows again next time.
  }
  emit();
}

export function currentUser(): DemoUser | null {
  const role = readRole();
  return USERS.find((u) => u.role === role) ?? null;
}

/** `undefined` until hydrated, then the user or `null` when no role is chosen. */
export function useUser(): DemoUser | null | undefined {
  const role = useSyncExternalStore(
    subscribe,
    () => readRole() ?? "none",
    () => "pending" as const,
  );
  if (role === "pending") return undefined;
  return USERS.find((u) => u.role === role) ?? null;
}

export const uid = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
