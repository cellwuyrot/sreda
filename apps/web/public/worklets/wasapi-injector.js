/**
 * WASAPI-SS AudioWorklet processor.
 *
 * Получает чанки PCM (interleaved Float32) через MessagePort
 * и выдаёт их в аудиограф с позиционированием в реальном времени.
 *
 * Де-интерливинг: WASAPI отдаёт [L0,R0,L1,R1,...],
 * AudioWorklet ожидает отдельные плоскости на канал.
 */
class WasapiInjectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Кольцевый буфер пер-канал (планарный Float32)
    this._bufs    = [[], []]; // max 2 канала
    this._offsets = [0, 0];
    this._ch      = 2;
    this._maxBuf  = 24;       // отбрасываем при заполнении > 24 чанков

    this.port.onmessage = (e) => {
      const { type } = e.data;
      if (type === 'config') {
        this._ch = Math.min(2, e.data.channels || 2);
      } else if (type === 'chunk') {
        const raw = e.data.data; // Float32Array, interleaved
        if (!raw || !raw.length) return;
        const frames = Math.floor(raw.length / this._ch);
        // Де-интерливинг по каналам
        for (let c = 0; c < this._ch; c++) {
          if (this._bufs[c].length >= this._maxBuf) {
            this._bufs[c].shift(); // отброс самого старого
          }
          const mono = new Float32Array(frames);
          for (let i = 0; i < frames; i++) mono[i] = raw[i * this._ch + c];
          this._bufs[c].push(mono);
        }
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;

    const blockSize = out[0].length; // обычно 128
    const chCount   = Math.min(this._ch, out.length);

    for (let c = 0; c < chCount; c++) {
      const channel = out[c];
      let written = 0;

      while (written < blockSize) {
        if (!this._bufs[c].length) {
          // Недостаток данных — тишина
          channel.fill(0, written);
          break;
        }
        const buf = this._bufs[c][0];
        const off = this._offsets[c];
        const avail  = buf.length - off;
        const needed = blockSize - written;
        const copy   = Math.min(avail, needed);

        channel.set(buf.subarray(off, off + copy), written);
        written          += copy;
        this._offsets[c] += copy;

        if (this._offsets[c] >= buf.length) {
          this._bufs[c].shift();
          this._offsets[c] = 0;
        }
      }
    }
    // Если выходов больше каналов WASAPI — остальные заполняем 0
    for (let c = chCount; c < out.length; c++) out[c].fill(0);
    return true;
  }
}

registerProcessor('wasapi-injector', WasapiInjectorProcessor);
