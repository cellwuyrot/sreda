/**
 * NoiseSuppressor
 *
 * Wraps an AudioWorklet-based RNNoise pipeline.
 * Usage:
 *   const ns = new NoiseSuppressor();
 *   const processed = await ns.init(rawMicStream);
 *   ns.setBypass(false);   // enable
 *   ns.setBypass(true);    // disable (pass-through)
 *   ns.destroy();          // clean up
 */

export type NSStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';

/** FIX-NS3: how long to wait for the worklet's 'ready' before declaring an error. */
// Linux/Electron may need a little longer to start a fresh AudioWorklet after
// an application update. A short watchdog incorrectly downgraded a healthy
// RNNoise instance to the native fallback on slower machines.
const READY_TIMEOUT_MS = 8000;

// public/ assets are not content-hashed by Next.js. Bump this whenever the
// direct WASM ABI/worklet changes so Electron and browsers cannot keep running
// an old processor against a new VoiceContext implementation.
const RNNOISE_ASSET_VERSION = '20260719-1';

// Compiling RNNoise WASM is one of the most expensive parts of joining voice.
// A compiled WebAssembly.Module is structured-cloneable and can be reused by
// every new AudioWorklet, so compile it once for the lifetime of the page.
type RnnoiseAssets = { module: WebAssembly.Module; bytes: ArrayBuffer };
let rnnoiseModulePromise: Promise<RnnoiseAssets> | null = null;

function loadRnnoiseModule(): Promise<RnnoiseAssets> {
  if (!rnnoiseModulePromise) {
    rnnoiseModulePromise = fetch(`/rnnoise.wasm?v=${RNNOISE_ASSET_VERSION}`, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error('rnnoise.wasm: HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(async bytes => ({ module: await WebAssembly.compile(bytes), bytes }))
      .catch(error => {
        // A transient deploy/network failure must not poison all later joins.
        rnnoiseModulePromise = null;
        throw error;
      });
  }
  return rnnoiseModulePromise;
}

export class NoiseSuppressor {
  private ctx:         AudioContext | null        = null;
  private sourceNode:  MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null   = null;
  private destNode:    MediaStreamAudioDestinationNode | null = null;
  private readyTimer:  ReturnType<typeof setTimeout> | null = null;
  private _status:     NSStatus = 'idle';
  private _bypass      = true;
  private _intensity   = 0.6;
  private _vadProb     = 0;
  private _onStatus:   ((s: NSStatus) => void) | null = null;
  private _onVad:      ((prob: number) => void) | null = null;

  get status()  { return this._status; }
  get vadProb() { return this._vadProb; }

  onStatus(cb: (s: NSStatus) => void) { this._onStatus = cb; }
  onVad(cb: (prob: number) => void)   { this._onVad = cb; }

  private _setStatus(s: NSStatus) {
    this._status = s;
    this._onStatus?.(s);
  }

  /**
   * Set up the full audio processing graph for the given mic stream.
   * Returns a NEW MediaStream whose audio track is the processed output.
   * Falls back to the original stream if AudioWorklet is unsupported.
   */
  async init(micStream: MediaStream): Promise<MediaStream> {
    if (typeof window === 'undefined') return micStream;
    if (!window.AudioContext) {
      this._setStatus('unsupported');
      return micStream;
    }

    this._setStatus('loading');

    // FIX-NS2: try a 48 kHz context first (RNNoise's native rate). Firefox
    // throws in createMediaStreamSource when the context rate differs from
    // the mic's rate - retry at the device rate in that case.
    try {
      return await this._build(micStream, 48000);
    } catch (err) {
      this._teardownGraph();
      try {
        return await this._build(micStream, undefined);
      } catch (err2) {
        console.warn('[NoiseSuppressor] init failed, falling back:', err2 ?? err);
        this._teardownGraph();
        this._setStatus('error');
        return micStream;
      }
    }
  }

  private async _build(micStream: MediaStream, sampleRate: number | undefined): Promise<MediaStream> {
    this.ctx = sampleRate ? new AudioContext({ sampleRate }) : new AudioContext();
    // The context may start "suspended" when created just after an `await`
    // (outside the original user gesture). If it stays suspended the worklet
    // never runs and the processed track is silent, so resume it explicitly.
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.ctx.state !== 'running') throw new Error('AudioContext is not running');

    // Register the worklet module
    await this.ctx.audioWorklet.addModule(`/worklets/rnnoise-processor.js?v=${RNNOISE_ASSET_VERSION}`);

    this.workletNode = new AudioWorkletNode(this.ctx, 'rnnoise-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const node = this.workletNode;

    // Do not return an outgoing track until WASM has really instantiated.
    // The graph is connected below before awaiting this promise because
    // Chromium only schedules processors that belong to a live render graph.
    let readyDone = false;
    let resolveReady!: () => void;
    let rejectReady!: (reason: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const failReady = (reason: Error) => {
      if (readyDone) return;
      readyDone = true;
      rejectReady(reason);
    };

    // FIX-NS4: a processor that throws during construction or inside
    // process() is terminated by the browser and reported ONLY via
    // "processorerror" on the node — which nobody listened to. After 'ready'
    // that meant peers received dead silence forever while the UI still
    // showed the suppressor as active. Surface it as 'error' so
    // VoiceContext's safety net (FIX-R4) reroutes transmission back to the
    // live raw microphone track.
    node.onprocessorerror = () => {
      if (this.workletNode !== node) return; // stale node from a failed build
      console.warn('[NoiseSuppressor] worklet processor crashed');
      if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
      if (readyDone) this._setStatus('error');
      else failReady(new Error('RNNoise processor crashed'));
    };

    // FIX-NS1 (root cause of "noise suppression changes nothing"): the worklet
    // used to receive raw WASM bytes and compile them with a synchronous
    // `new WebAssembly.Module(bytes)`. Synchronous compilation of modules
    // larger than 4 KB is forbidden in many Chromium/Electron builds even off
    // the main thread - the worklet threw, 'ready' never arrived, and the
    // processor stayed in pass-through mode forever: audio kept flowing to
    // peers completely UNPROCESSED, so toggling the suppressor had no audible
    // effect on any frequency. We now compile asynchronously here on the main
    // thread and transfer the compiled WebAssembly.Module (it is structured
    // cloneable); the worklet only performs an instant instantiation.
    const wasm = await loadRnnoiseModule();

    node.port.onmessage = ({ data }) => {
      if (this.workletNode !== node) return; // stale node from a failed build
      if (data.type === 'ready') {
        if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
        if (!readyDone) { readyDone = true; resolveReady(); }
        console.info(`[NoiseSuppressor] ready (init path: ${initPath})`);
        this._setStatus('ready');
        // Apply the bypass + intensity state that was set before ready
        node.port.postMessage({ type: 'bypass', value: this._bypass });
        node.port.postMessage({ type: 'intensity', value: this._intensity });
      }
      if (data.type === 'error') {
        if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
        console.warn('[NoiseSuppressor] worklet error:', data.message);
        // FIX-NS5: до 'ready' пробуем второй путь инициализации (сырые байты).
        if (!readyDone && retryWithBytes(String(data.message ?? 'worklet error'))) return;
        if (readyDone) this._setStatus('error');
        else failReady(new Error(data.message || 'RNNoise worklet failed'));
      }
      if (data.type === 'vad') {
        this._vadProb = data.prob;
        this._onVad?.(data.prob);
      }
    };

    // Current Chromium can structured-clone WebAssembly.Module. Some older
    // Linux Electron builds cannot, so fall back to bytes and compile them
    // asynchronously inside the worklet instead of disabling suppression.
    // FIX-NS5 (десктоп): клонирование Module может пройти без исключения, но
    // модуль приходит в воркалет непригодным, либо инстанцирование падает уже
    // там — раньше это заканчивалось вечным passthrough. Теперь при ошибке
    // воркалета или молчании до таймаута инициализация автоматически
    // повторяется сырыми байтами (асинхронная компиляция внутри воркалета), и
    // только после провала обоих путей статус падает в 'error' (нативный
    // шумодав через страховку FIX-R4).
    const retryWithBytes = (reason: string): boolean => {
      if (readyDone || initPath === 'bytes' || this.workletNode !== node) return false;
      initPath = 'bytes';
      console.warn(`[NoiseSuppressor] module init failed (${reason}) — retrying with raw bytes`);
      try {
        node.port.postMessage({ type: 'init', bytes: wasm.bytes });
      } catch {
        return false;
      }
      armWatchdog();
      return true;
    };

    // FIX-NS3: watchdog - if the worklet never reports 'ready', flip to
    // 'error' so VoiceContext's safety net reroutes transmission to the live
    // raw mic track instead of the dead node's output.
    const armWatchdog = () => {
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => {
        if (this._status !== 'loading') return;
        if (retryWithBytes('ready timeout')) return;
        console.warn('[NoiseSuppressor] worklet did not become ready in time');
        failReady(new Error('RNNoise worklet ready timeout'));
      }, READY_TIMEOUT_MS);
    };

    let initPath: 'module' | 'bytes' = 'module';
    try {
      node.port.postMessage({ type: 'init', module: wasm.module });
    } catch {
      initPath = 'bytes';
      node.port.postMessage({ type: 'init', bytes: wasm.bytes });
    }
    armWatchdog();

    // Build graph: source -> worklet -> destination.
    // In Firefox this line throws on a sample-rate mismatch (caught in init()).
    this.sourceNode = this.ctx.createMediaStreamSource(micStream);
    this.destNode   = this.ctx.createMediaStreamDestination();

    this.sourceNode.connect(node);
    node.connect(this.destNode);

    await ready;

    // Return the processed stream (keeps original video tracks if any)
    const processedStream = this.destNode.stream;
    // Copy non-audio tracks (e.g., screen video) from original
    micStream.getVideoTracks().forEach(t => processedStream.addTrack(t));

    return processedStream;
  }

  private _teardownGraph() {
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
    try {
      this.workletNode?.disconnect();
      this.sourceNode?.disconnect();
      this.destNode?.stream.getTracks().forEach(t => t.stop());
      this.ctx?.close();
    } catch { /* ignore */ }
    this.workletNode = null;
    this.sourceNode  = null;
    this.destNode    = null;
    this.ctx         = null;
  }

  /** true = pass-through (no processing), false = denoise active */
  setBypass(bypass: boolean) {
    this._bypass = bypass;
    this.workletNode?.port.postMessage({ type: 'bypass', value: bypass });
  }

  /**
   * Strength of the VAD-driven noise gate applied on top of RNNoise.
   * 0 = plain RNNoise (no gate), 1 = maximum gating. Safe to call before
   * `init()`; the value is re-sent once the worklet reports ready.
   */
  setIntensity(intensity: number) {
    this._intensity = Math.max(0, Math.min(1, intensity));
    this.workletNode?.port.postMessage({ type: 'intensity', value: this._intensity });
  }

  destroy() {
    this._teardownGraph();
    this._setStatus('idle');
  }
}
