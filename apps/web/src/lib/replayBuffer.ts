/**
 * FIX-REPLAY: кольцевой буфер «мгновенного повтора» (как Instant Replay в
 * ShadowPlay/OBS). Хранит последние ~30 секунд смикшированного звука голосового
 * канала и, если есть, видео активной трансляции.
 *
 * Почему два MediaRecorder, а не один с timeslice: WebM-чанки MediaRecorder не
 * самодостаточны (заголовок контейнера есть только в первом чанке), поэтому
 * «выкинуть старые чанки и склеить хвост» нельзя. Вместо этого два рекордера
 * пишут внахлёст со сдвигом в 30 секунд, каждый живёт максимум 60 секунд.
 * В момент сохранения останавливается тот, что работает дольше, — его запись
 * всегда содержит от 30 до 60 последних секунд.
 *
 * Всё происходит локально (Web Audio + MediaRecorder на устройстве
 * пользователя): ни один байт записи не отправляется на сервер.
 */

type Segment = {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
};

export class ReplayRecorder {
  private stream: MediaStream;
  private windowMs: number;
  private segments: Segment[] = [];
  private rotateTimer: ReturnType<typeof setInterval> | null = null;
  private mimeType: string;
  private stopped = false;

  constructor(stream: MediaStream, windowMs = 30_000) {
    this.stream = stream;
    this.windowMs = windowMs;
    this.mimeType = ReplayRecorder.pickMimeType(stream.getVideoTracks().length > 0);
  }

  static isSupported(): boolean {
    return typeof MediaRecorder !== "undefined";
  }

  /** Наиболее совместимый поддерживаемый контейнер/кодек для записи. */
  static pickMimeType(withVideo: boolean): string {
    const candidates = withVideo
      ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      : ["audio/webm;codecs=opus", "audio/webm"];
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c)) return c;
      } catch { /* ignore */ }
    }
    return "";
  }

  /** Начать буферизацию. */
  start(): void {
    if (this.stopped || this.rotateTimer) return;
    this.spawnSegment();
    // Каждые windowMs стартует новый сегмент-«сменщик»; сегмент старше двух
    // окон уже полностью перекрыт более новым и выбрасывается.
    this.rotateTimer = setInterval(() => this.rotate(), this.windowMs);
  }

  /** true, когда буфер уже пишет и есть что сохранять. */
  get ready(): boolean {
    return !this.stopped && this.segments.length > 0;
  }

  /**
   * Сохранить последние 30–60 секунд: останавливает самый старый активный
   * сегмент, собирает из его чанков готовый файл и тут же запускает замену,
   * чтобы буфер продолжал работать без паузы.
   */
  async save(): Promise<Blob | null> {
    if (this.stopped || !this.segments.length) return null;
    const seg = this.segments.shift()!;
    const blob = await ReplayRecorder.finalize(seg);
    if (!this.stopped) this.spawnSegment();
    return blob && blob.size ? blob : null;
  }

  /** Полностью остановить буферизацию и освободить ресурсы. */
  stop(): void {
    this.stopped = true;
    if (this.rotateTimer) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = null;
    }
    for (const seg of this.segments) {
      try { seg.recorder.stop(); } catch { /* ignore */ }
      seg.chunks.length = 0;
    }
    this.segments = [];
  }

  private spawnSegment(): void {
    try {
      const recorder = new MediaRecorder(this.stream, {
        ...(this.mimeType ? { mimeType: this.mimeType } : {}),
        audioBitsPerSecond: 128_000,
        videoBitsPerSecond: 3_000_000,
      });
      const seg: Segment = { recorder, chunks: [], startedAt: Date.now() };
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) seg.chunks.push(e.data);
      };
      recorder.start();
      this.segments.push(seg);
    } catch {
      // Кодек/запись недоступны — буфер просто останется не готов.
    }
  }

  private rotate(): void {
    if (this.stopped) return;
    this.spawnSegment();
    while (this.segments.length > 2) {
      const old = this.segments.shift()!;
      try { old.recorder.stop(); } catch { /* ignore */ }
      old.chunks.length = 0;
    }
  }

  /** Остановить сегмент и дождаться его финальных данных. */
  private static finalize(seg: Segment): Promise<Blob | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        try {
          resolve(new Blob(seg.chunks, { type: seg.recorder.mimeType || "video/webm" }));
        } catch {
          resolve(null);
        }
      };
      if (seg.recorder.state === "inactive") {
        done();
        return;
      }
      seg.recorder.onstop = done;
      try { seg.recorder.stop(); } catch { done(); }
      // Страховка: если onstop так и не пришёл, не зависать навсегда.
      setTimeout(done, 3_000);
    });
  }
}
