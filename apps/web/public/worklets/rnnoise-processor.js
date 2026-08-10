/**
 * RNNoise AudioWorklet Processor
 *
 * Web Audio delivers 128-sample chunks; RNNoise needs 480-sample frames.
 * We buffer 480 samples, denoise, drain results back in 128-sample pieces.
 * All buffers are pre-allocated — no GC during processing.
 *
 * Scaling: WebAudio [-1..1] ↔ RNNoise float as int16 range [-32768..32767].
 *
 * WASM loading: an `AudioWorkletGlobalScope` has NO `importScripts`, NO `fetch`
 * and NO ES-module `import`, so the Emscripten glue (which needs all three)
 * cannot run here. Instead the main thread fetches `rnnoise.wasm`, transfers the
 * raw bytes over the worklet port, and we instantiate the module *directly*.
 *
 * The `.wasm` is copied from the `@jitsi/rnnoise-wasm` package at build time and
 * its exports are minified to single letters that can shift between package
 * versions. Rather than hard-code them, we auto-detect the ABI by signature:
 * the exported linear memory, `__wasm_call_ctors` (arity 0),
 * `rnnoise_process_frame` (arity 3) and the `malloc`/`rnnoise_create` pair
 * (arity 1) are found by probing throwaway instances until one actually
 * denoises a frame. The module's only imports are `emscripten_resize_heap`
 * (1 arg) and `emscripten_memcpy_big` (3 args); a single "smart" function
 * satisfies both regardless of their import names.
 */

const FRAME   = 480;
const SCALE   = 32768;
const BUF_LEN = 4096;            // power of 2, must be > FRAME * 2
const BUF_MASK = BUF_LEN - 1;    // 4095 — safe for bitwise AND wrapping

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._bypass = true;
    this._ready  = false;
    this._broken = false;  // FIX-W2: permanent pass-through after a process() crash
    this._malloc = null;
    this._create = null;
    this._proc   = null;
    this._memory = null;
    this._heapBuf = null;   // cached ArrayBuffer backing _heapF32
    this._heapF32 = null;   // Float32Array view over the WASM heap
    this._state  = 0;
    this._inPtr  = 0;
    this._outPtr = 0;
    this._vadProb = 0;
    this._intensity = 0.6;   // 0 = plain RNNoise, 1 = maximum gating
    this._gain      = 1;     // smoothed gate gain applied to the output
    this._outputPrimed = false;

    // Ring buffers — power-of-2 size for correct bitwise wrapping
    this._inQueue  = new Float32Array(BUF_LEN);
    this._outQueue = new Float32Array(BUF_LEN);
    this._inHead  = 0; this._inTail  = 0;
    this._outHead = 0; this._outTail = 0;

    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case 'bypass':    this._bypass = data.value; break;
        case 'intensity': this._intensity = Math.max(0, Math.min(1, data.value)); break;
        case 'init':      this._load(data); break;
      }
    };
  }

  /**
   * Instantiate the module once with a "smart" import that serves both
   * `emscripten_resize_heap(size)->i32` and `emscripten_memcpy_big(d,s,n)->void`,
   * runs the static constructors, and returns the exports + memory.
   */
  _instantiate(module) {
    let mem = null;
    let u8  = null;
    const smart = (a, b, c) => {
      if (b === undefined) {          // emscripten_resize_heap(requestedSize)
        try {
          mem.grow((a - mem.buffer.byteLength + 65535) >>> 16);
          u8 = new Uint8Array(mem.buffer);
          return 1;
        } catch { return 0; }
      }
      u8.copyWithin(a, b, b + c);     // emscripten_memcpy_big(dest, src, num)
    };

    const imports = {};
    for (const { module: m, name, kind } of WebAssembly.Module.imports(module)) {
      if (kind === 'function') (imports[m] ??= {})[name] = smart;
    }

    const instance = new WebAssembly.Instance(module, imports);
    const ex = instance.exports;
    mem = Object.values(ex).find(v => v instanceof WebAssembly.Memory);
    if (!mem) return null;
    u8 = new Uint8Array(mem.buffer);
    // Run static constructors (__wasm_call_ctors is the sole arity-0 export).
    for (const v of Object.values(ex)) {
      if (typeof v === 'function' && v.length === 0) { try { v(); } catch { /* ignore */ } }
    }
    return { ex, memory: mem };
  }

  /**
   * Find malloc / rnnoise_create / rnnoise_process_frame by signature. The
   * winning combo is the one that allocates buffers, creates a state, and
   * returns a finite VAD probability in [0,1] for a real frame.
   */
  _resolveAbi(module) {
    // @jitsi/rnnoise-wasm 0.2.1 has stable minified exports. Avoid creating
    // and probing dozens of fresh instances on every join: that was slow on
    // Linux/Electron and could hit the main thread's ready watchdog.
    const known = this._instantiate(module);
    if (known &&
        typeof known.ex.f === 'function' && known.ex.f.length === 1 &&
        typeof known.ex.g === 'function' && known.ex.g.length === 1 &&
        typeof known.ex.j === 'function' && known.ex.j.length === 3) {
      return { mallocK: 'g', createK: 'f', procK: 'j' };
    }

    // Keep signature probing only as a compatibility fallback for a future
    // package version with different minified names.
    const probe = this._instantiate(module);
    if (!probe) return null;
    const fns = Object.entries(probe.ex).filter(([, v]) => typeof v === 'function');
    const arity1 = fns.filter(([, v]) => v.length === 1).map(([k]) => k);
    const arity3 = fns.filter(([, v]) => v.length === 3).map(([k]) => k);

    for (const procK of arity3) {
      for (const createK of arity1) {
        for (const mallocK of arity1) {
          if (createK === mallocK) continue;
          try {
            const { ex, memory } = this._instantiate(module);
            const malloc = ex[mallocK], create = ex[createK], proc = ex[procK];
            const inPtr = malloc(FRAME * 4), outPtr = malloc(FRAME * 4);
            if (!inPtr || !outPtr) continue;
            const state = create(0);
            if (!state) continue;
            const hf = new Float32Array(memory.buffer);
            for (let i = 0; i < FRAME; i++) hf[(inPtr >>> 2) + i] = (Math.random() * 2 - 1) * 1000;
            const vad = proc(state, outPtr, inPtr);
            if (typeof vad === 'number' && isFinite(vad) && vad >= 0 && vad <= 1) {
              return { mallocK, createK, procK };
            }
          } catch { /* wrong combo — keep trying */ }
        }
      }
    }
    return null;
  }

  /** Re-derive the heap view if the WASM memory grew (buffer got detached). */
  _heap() {
    if (this._heapBuf !== this._memory.buffer) {
      this._heapBuf = this._memory.buffer;
      this._heapF32 = new Float32Array(this._heapBuf);
    }
    return this._heapF32;
  }

  /**
   * Instantiate rnnoise.wasm synchronously from the transferred bytes.
   * The module arrives pre-compiled from the main thread (FIX-NS1); only
   * instantiation happens here, which is allowed everywhere.
   */
  async _load(data) {
    try {
      // FIX-NS1: the main thread now sends a pre-compiled WebAssembly.Module.
      // Synchronous compilation of modules larger than 4 KB can be forbidden
      // by the engine even off the main thread - then 'ready' never arrived
      // and this processor stayed in pass-through forever, which is exactly
      // why noise suppression had no audible effect. Raw bytes are still
      // accepted as a fallback.
      // A structured-cloned WebAssembly.Module comes from another JS realm.
      // Some Electron versions therefore fail `instanceof WebAssembly.Module`
      // even though the object is a valid module. Prefer any supplied module
      // and validate it through the WebAssembly API; compile bytes only when a
      // module was not transferred.
      let module;
      if (data.module) {
        WebAssembly.Module.exports(data.module); // throws for an invalid value
        module = data.module;
      } else {
        if (!data.bytes) throw new Error('rnnoise module/bytes missing');
        module = await WebAssembly.compile(data.bytes);
      }
      const abi = this._resolveAbi(module);
      if (!abi) throw new Error('rnnoise ABI detection failed');

      const { ex, memory } = this._instantiate(module);
      this._memory = memory;
      this._malloc = ex[abi.mallocK];
      this._create = ex[abi.createK];
      this._proc   = ex[abi.procK];

      this._inPtr  = this._malloc(FRAME * 4);
      this._outPtr = this._malloc(FRAME * 4);
      this._state  = this._create(0); // NULL model → built-in default
      if (!this._inPtr || !this._outPtr || !this._state) {
        throw new Error('rnnoise allocation failed');
      }

      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  process(inputs, outputs) {
    const src = inputs[0]?.[0];
    const dst = outputs[0]?.[0];
    if (!src || !dst) return true;

    // ── BYPASS ───────────────────────────────────────────────────────────
    if (this._bypass || !this._ready || this._broken) {
      dst.set(src);
      return true;
    }

    try {
      this._processChunk(src, dst);
    } catch (e) {
      // FIX-W2: an exception escaping process() makes the browser terminate
      // the processor for good ("processorerror") — peers would then receive
      // dead silence while the UI still claims suppression is active.
      // Degrade to permanent pass-through instead and report the failure.
      this._broken = true;
      dst.set(src);
      this.port.postMessage({ type: 'error', message: 'process failed: ' + (e && e.message ? e.message : String(e)) });
    }
    return true;
  }

  _processChunk(src, dst) {
    const chunk = src.length; // 128

    // ── ENQUEUE INPUT (scale to int16 range) ─────────────────────────────
    for (let i = 0; i < chunk; i++) {
      this._inQueue[this._inTail++ & BUF_MASK] = src[i] * SCALE;
    }

    // ── PROCESS COMPLETE 480-SAMPLE FRAMES ───────────────────────────────
    while ((this._inTail - this._inHead) >= FRAME) {
      const heap = this._heap();
      const inBase  = this._inPtr  >>> 2;
      const outBase = this._outPtr >>> 2;

      for (let i = 0; i < FRAME; i++) {
        heap[inBase + i] = this._inQueue[this._inHead++ & BUF_MASK];
      }

      this._vadProb = this._proc(this._state, this._outPtr, this._inPtr);

      // FIX-W1: _proc may grow WASM memory, which detaches the `heap` view
      // captured above. Reading a detached view yields undefined → NaN in the
      // output queue (heard as garbage or dead silence from then on).
      // Re-derive the view before reading the processed frame back.
      const heapOut = this._heap();
      for (let i = 0; i < FRAME; i++) {
        this._outQueue[this._outTail++ & BUF_MASK] = heapOut[outBase + i];
      }
    }

    // ── VAD-DRIVEN NOISE GATE ─────────────────────────────────────────────
    // RNNoise attenuates noise spectrally; the gate adds a second, far more
    // audible layer. During frames the model marks as non-speech we duck the
    // signal toward a floor, so the noise between words drops out instead of
    // merely getting quieter. `_intensity` scales both how eagerly the gate
    // closes (threshold) and how deep it ducks (floor): at intensity 0 the gate
    // is a no-op (plain RNNoise), at 1 it is aggressive (≈ −40 dB floor).
    let targetGain = 1;
    if (this._intensity > 0) {
      const floor     = Math.pow(10, -2 * this._intensity);   // 0 dB … −40 dB
      const threshold = 0.15 + 0.5 * this._intensity;         // speech-prob center
      const lo = threshold - 0.10, hi = threshold + 0.10;     // soft transition band
      const t  = Math.max(0, Math.min(1, (this._vadProb - lo) / (hi - lo)));
      targetGain = floor + (1 - floor) * t;
    }
    // Fast attack (open instantly for speech), slower release (close gently) so
    // the gate never clips a word onset yet doesn't chatter on the noise tail.
    const smooth = targetGain > this._gain ? 0.6 : 0.05;
    this._gain += (targetGain - this._gain) * smooth;

    // ── DRAIN OUTPUT (scale back to [-1..1], apply gate gain) ──────────────
    const outAvail = this._outTail - this._outHead;
    // 480-sample RNNoise frames and 128-sample WebAudio quanta do not align.
    // Prime two frames before draining so the queue never underruns every
    // fourth quantum (which sounded like suppression was broken on Linux).
    if (!this._outputPrimed && outAvail >= FRAME * 2) this._outputPrimed = true;
    if (this._outputPrimed && outAvail >= chunk) {
      for (let i = 0; i < chunk; i++) {
        dst[i] = (this._outQueue[this._outHead++ & BUF_MASK] / SCALE) * this._gain;
      }
    } else {
      // Not enough processed samples yet — output silence to avoid glitch
      dst.fill(0);
    }

    // Periodically report VAD probability to the main thread
    if (Math.random() < 0.04) {   // ~every 25 chunks ≈ every 83 ms
      this.port.postMessage({ type: 'vad', prob: this._vadProb });
    }
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
