export class SpeechRecognizer {
  private recognition: any;
  private isListening = false;
  private retryCount = 0;
  private static MAX_RETRIES = 2;

  constructor() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('[SpeechRecognizer] API not available.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'pt-BR';
    this.recognition.maxAlternatives = 1;
  }

  get isAvailable() {
    return !!this.recognition;
  }

  get listening() {
    return this.isListening;
  }

  start(
    onResult: (text: string) => void,
    onError?: (err: string) => void,
    onStart?: () => void,
  ) {
    if (!this.recognition || this.isListening) return;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.retryCount = 0;
      console.log('[SR] started');
      onStart?.();
    };

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      console.log('[SR] result:', transcript);
      this.isListening = false;
      onResult(transcript);
    };

    this.recognition.onerror = (event: any) => {
      console.error('[SR] error:', event.error);
      this.isListening = false;

      // 'network' error: retry up to MAX_RETRIES times (cache warming)
      if (event.error === 'network' && this.retryCount < SpeechRecognizer.MAX_RETRIES) {
        this.retryCount++;
        console.log(`[SR] network error — retrying (${this.retryCount})`);
        setTimeout(() => {
          try {
            this.recognition.start();
            this.isListening = true;
          } catch (e) {
            onError?.(`Falha de rede ao iniciar reconhecimento (${event.error})`);
          }
        }, 300);
        return;
      }

      const messages: Record<string, string> = {
        'network':       'Sem acesso à rede para reconhecimento de voz. Verifique a conexão.',
        'not-allowed':   'Permissão de microfone negada.',
        'no-speech':     'Nenhuma fala detectada.',
        'aborted':       'Reconhecimento cancelado.',
        'audio-capture': 'Falha ao capturar áudio do microfone.',
        'service-not-allowed': 'Serviço de reconhecimento bloqueado.',
      };

      onError?.(messages[event.error] ?? `Erro: ${event.error}`);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      console.log('[SR] ended');
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      this.isListening = false;
      onError?.(`Falha ao iniciar: ${e.message}`);
    }
  }

  stop() {
    if (!this.recognition || !this.isListening) return;
    try {
      this.recognition.stop();
    } catch (e) {
      console.error('[SR] stop error:', e);
    }
    this.isListening = false;
  }

  abort() {
    if (!this.recognition) return;
    try {
      this.recognition.abort();
    } catch {}
    this.isListening = false;
  }
}
