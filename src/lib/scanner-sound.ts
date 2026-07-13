// Bips simples via WebAudio para feedback de scanner.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function beep(freq: number, durationMs: number, type: OscillatorType = "sine", gainVal = 0.12) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainVal, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + durationMs / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + durationMs / 1000);
}

export function beepOk() {
  beep(1100, 120, "sine", 0.14);
}

export function beepError() {
  beep(280, 240, "square", 0.15);
  setTimeout(() => beep(220, 180, "square", 0.15), 120);
}

export function beepWarn() {
  beep(700, 90, "triangle", 0.12);
  setTimeout(() => beep(700, 90, "triangle", 0.12), 110);
}