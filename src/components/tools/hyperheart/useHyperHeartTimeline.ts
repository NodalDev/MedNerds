import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceTimeline, normalizeSourceFrame } from '../../../lib/tools/hyperheart/timeline';

/** One clock per tool instance. All panels receive its fractional source frame. */
export function useHyperHeartTimeline(initialFrame: number, rate: number, loop: boolean, autoPlay: boolean) {
  const [sourceFrame, setSourceFrame] = useState(initialFrame);
  const frameRef = useRef(initialFrame);
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  const animationRef = useRef<number | null>(null);

  const pause = useCallback(() => {
    playingRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setIsPlaying(false);
  }, []);

  const seek = useCallback((frame: number) => {
    pause();
    frameRef.current = normalizeSourceFrame(frame);
    setSourceFrame(frameRef.current);
  }, [pause]);

  const play = useCallback(() => {
    playingRef.current = true;
    setIsPlaying(true);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (autoPlay && !motion.matches) play(); else pause();
    const handleChange = (event: MediaQueryListEvent) => { if (event.matches) pause(); };
    motion.addEventListener('change', handleChange);
    return () => motion.removeEventListener('change', handleChange);
  }, [autoPlay, pause, play]);

  useEffect(() => {
    if (!isPlaying) return;
    let previous = performance.now();
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const next = advanceTimeline(frameRef.current, now - previous, rate, loop);
      previous = now;
      frameRef.current = next.frame;
      setSourceFrame(next.frame);
      if (next.ended) pause();
      else animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [isPlaying, rate, loop, pause]);

  return { sourceFrame, frameRef, isPlaying, seek, pause, play };
}
