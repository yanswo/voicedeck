// Speech recognition via MediaRecorder + Whisper API
// Falls back to webkitSpeechRecognition if Whisper key not configured

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

function getWhisperKey(): string | null {
  return localStorage.getItem('openai_api_key');
}

async function transcribeWithWhisper(audioBlob: Blob): Promise<string> {
  const key = getWhisperKey();
  if (!key) throw new Error('NO_WHISPER_KEY');

  const form = new FormData();
  form.append('file', audioBlob, 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const response = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    body: form,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Whisper error ${response.status}`);
  }

  const data = await response.json();
  return data.text?.trim() ?? '';
}

// ---- MediaRecorder-based recorder ----
export class SpeechRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private isRecording = false;
  private deviceId: string = 'default';

  setDevice(deviceId: string) {
    this.deviceId = deviceId;
  }

  get recording() {
    return this.isRecording;
  }

  async start(): Promise<void> {
    if (this.isRecording) return;

    const constraints: MediaStreamConstraints = {
      audio: this.deviceId === 'default'
        ? true
        : { deviceId: { exact: this.deviceId } }
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.chunks = [];

    // Pick supported mime type
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus';

    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(100); // collect every 100ms
    this.isRecording = true;
  }

  async stop(): Promise<string> {
    if (!this.recorder || !this.isRecording) return '';
    this.isRecording = false;

    return new Promise((resolve, reject) => {
      this.recorder!.onstop = async () => {
        // Stop all tracks
        this.stream?.getTracks().forEach(t => t.stop());

        const blob = new Blob(this.chunks, { type: this.recorder!.mimeType });
        this.chunks = [];

        if (blob.size < 1000) {
          resolve(''); // Too short — nothing heard
          return;
        }

        try {
          // Try Whisper first
          const text = await transcribeWithWhisper(blob);
          resolve(text);
        } catch (e: any) {
          if (e.message === 'NO_WHISPER_KEY') {
            // Fall back to Web Speech API (may still work in some setups)
            resolve('__NO_KEY__');
          } else {
            reject(e);
          }
        }
      };

      this.recorder!.stop();
    });
  }

  abort() {
    if (this.recorder && this.isRecording) {
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach(t => t.stop());
    this.isRecording = false;
    this.chunks = [];
  }
}

// ---- Web Speech API fallback (for when Whisper key is not set) ----
export class WebSpeechRecognizer {
  private recognition: any;
  private isListening = false;

  get isAvailable() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return !!SR;
  }

  start(onResult: (text: string) => void, onError?: (err: string) => void) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || this.isListening) return;

    this.recognition = new SR();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'pt-BR';

    this.recognition.onresult = (e: any) => {
      this.isListening = false;
      onResult(e.results[0][0].transcript);
    };

    this.recognition.onerror = (e: any) => {
      this.isListening = false;
      const msgs: Record<string, string> = {
        'network': 'Sem rede para o reconhecimento de voz. Configure uma API Key OpenAI nas configurações.',
        'not-allowed': 'Permissão de microfone negada.',
        'no-speech': 'Nada foi ouvido.',
        'audio-capture': 'Erro ao capturar áudio.',
      };
      onError?.(msgs[e.error] ?? `Erro: ${e.error}`);
    };

    this.recognition.onend = () => { this.isListening = false; };

    try {
      this.recognition.start();
      this.isListening = true;
    } catch (e: any) {
      onError?.(e.message);
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      try { this.recognition.stop(); } catch {}
      this.isListening = false;
    }
  }
}
