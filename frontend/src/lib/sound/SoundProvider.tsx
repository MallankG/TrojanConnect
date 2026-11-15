"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { sound, type Cue, type CueOptions } from "./engine";

const STORAGE_KEY = "tc-sound";
type Pref = "on" | "off";

type SoundContextValue = {
  /** True when the visitor has asked for sound. */
  on: boolean;
  /** Turn sound on. Must be called from a click or key handler. */
  enable: () => void;
  disable: () => void;
  toggle: () => void;
  play: (cue: Cue, opts?: CueOptions) => void;
  setDrone: (level: number) => void;
  killDrone: () => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);

// The preference lives in localStorage so it survives reloads and is shared by
// the landing page and the app.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function readPref(): Pref {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}
function writePref(pref: Pref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Private mode: the choice just won't persist.
  }
  listeners.forEach((l) => l());
}

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const pref = useSyncExternalStore(subscribe, readPref, () => "off" as Pref);
  const on = pref === "on";

  // After a reload the preference may already be "on", but the browser still
  // needs a gesture before it will make sound. Unlock on the first one.
  useEffect(() => {
    if (!on) {
      sound.setMuted(true);
      return;
    }
    const unlock = () => {
      if (sound.unlock()) sound.setMuted(false);
    };
    if (sound.ready) unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [on]);

  const enable = useCallback(() => {
    if (sound.unlock()) sound.setMuted(false);
    writePref("on");
  }, []);
  const disable = useCallback(() => {
    sound.setMuted(true);
    writePref("off");
  }, []);
  const toggle = useCallback(() => {
    if (readPref() === "on") disable();
    else enable();
  }, [enable, disable]);

  const value = useMemo<SoundContextValue>(
    () => ({
      on,
      enable,
      disable,
      toggle,
      play: (cue, opts) => sound.play(cue, opts),
      setDrone: (level) => sound.setDrone(level),
      killDrone: () => sound.killDrone(),
    }),
    [on, enable, disable, toggle],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used inside SoundProvider");
  return ctx;
}
