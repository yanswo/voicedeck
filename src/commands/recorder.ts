// Audio recorder using MediaRecorder API
export class AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private _recording = false;
  private deviceId: string = 'default';

  get recording() { return this._recording; }

  setDevice(id: string) { this.deviceId = id; }

  async start(): Promise<void> {
    if (this._recording) return;

    const constraints: MediaStreamConstraints = {
      audio: this.deviceId === 'default'
        ? { echoCancellation: true, noiseSuppression: true }
        : { deviceId: { exact: this.deviceId }, echoCancellation: true, noiseSuppression: true }
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.chunks = [];

    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ].find(t => MediaRecorder.isTypeSupported(t)) ?? '';

    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(100);
    this._recording = true;
  }

  async stop(): Promise<Blob | null> {
    if (!this.recorder || !this._recording) return null;
    this._recording = false;

    return new Promise((resolve) => {
      this.recorder!.onstop = () => {
        this.stream?.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.chunks, {
          type: this.recorder!.mimeType || 'audio/webm'
        });
        this.chunks = [];
        resolve(blob.size > 500 ? blob : null);
      };
      this.recorder!.stop();
    });
  }

  abort() {
    if (this.recorder && this._recording) {
      try { this.recorder.stop(); } catch {}
    }
    this.stream?.getTracks().forEach(t => t.stop());
    this._recording = false;
    this.chunks = [];
  }
}
