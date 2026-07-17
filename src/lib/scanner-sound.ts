// Bips via WebAudio para feedback operacional do scanner.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }

  // Alguns navegadores suspendem o contexto até a primeira interação do usuário.
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  return ctx;
}

function beep(
  freq: number,
  durationMs: number,
  type: OscillatorType = "sine",
  gainVal = 0.12,
) {
  const a = audio();
  if (!a) return;

  const osc = a.createOscillator();
  const gain = a.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(gainVal, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    a.currentTime + durationMs / 1000,
  );

  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + durationMs / 1000);
}

export function beepOk() {
  beep(1100, 120, "sine", 0.14);
}

export function beepError() {
  // Alarme forte, longo e inconfundível para erro operacional.
  beep(320, 500, "square", 0.85);
  setTimeout(() => beep(220, 500, "square", 0.85), 260);
  setTimeout(() => beep(320, 650, "square", 0.95), 540);
}

export function beepWarn() {
  beep(700, 110, "triangle", 0.2);
  setTimeout(() => beep(700, 110, "triangle", 0.2), 140);
}
