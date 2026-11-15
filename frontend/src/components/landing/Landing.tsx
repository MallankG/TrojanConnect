"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { useSound } from "@/lib/sound/SoundProvider";
import { sound } from "@/lib/sound/engine";
import { useIsNarrow, useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { Header, type HeaderTheme } from "./Header";
import { Hero } from "./Hero";
import { ChaosStage } from "./ChaosStage";
import { Solution } from "./Solution";
import { Network, Principle, Start } from "./Closing";
import { Campus } from "./Campus";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function Landing() {
  const reduced = useReducedMotion();
  const narrow = useIsNarrow();
  const { enable, disable } = useSound();
  const [entered, setEntered] = useState(false);
  const [theme, setTheme] = useState<HeaderTheme>("dark");
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const lenis = useRef<Lenis | null>(null);

  const setThemeStable = useCallback((next: HeaderTheme) => {
    setTheme((prev) => (prev === next ? prev : next));
  }, []);

  // The fixed bar is transparent over the hero and gains a backdrop after that,
  // so headlines scrolling underneath it stay readable.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Always start at the top: the story only makes sense from the first line.
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    return () => {
      history.scrollRestoration = previous;
      sound.setDrone(0);
    };
  }, []);

  // Smooth scrolling drives the scrubbed scenes. Skipped for reduced motion.
  useEffect(() => {
    if (reduced) return;
    const instance = new Lenis({ lerp: 0.11, wheelMultiplier: 0.9 });
    lenis.current = instance;
    instance.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      lenis.current = null;
    };
  }, [reduced]);

  // The page is locked until the visitor chooses how to enter.
  useEffect(() => {
    const html = document.documentElement;
    if (entered) {
      html.style.overflow = "";
      lenis.current?.start();
    } else {
      html.style.overflow = "hidden";
      lenis.current?.stop();
    }
    return () => {
      html.style.overflow = "";
    };
  }, [entered, reduced]);

  // The fixed header takes its colours from whichever scene is under it.
  useGSAP(
    () => {
      const zones = gsap.utils.toArray<HTMLElement>("[data-header]", root.current);
      zones.forEach((zone) => {
        ScrollTrigger.create({
          trigger: zone,
          start: "top 36px",
          end: "bottom 36px",
          onToggle: (self) => {
            if (self.isActive) setThemeStable(zone.dataset.header as HeaderTheme);
          },
        });
      });
      // Web fonts change line breaks; measure again once they are in.
      document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },
    { scope: root, dependencies: [reduced, narrow], revertOnUpdate: true },
  );

  const handleEnter = (withSound: boolean) => {
    if (withSound) enable();
    else disable();
    setEntered(true);
  };

  return (
    <div ref={root}>
      <Header theme={theme} showCta={entered} scrolled={scrolled} />
      <main>
        <Hero entered={entered} reduced={reduced} onEnter={handleEnter} />
        <ChaosStage reduced={reduced} narrow={narrow} setTheme={setThemeStable} />
        <Solution reduced={reduced} />
        <Principle />
        <Network reduced={reduced} />
        <Campus reduced={reduced} />
        <Start />
      </main>
    </div>
  );
}
