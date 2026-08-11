// Local Whisper transcription using @xenova/transformers (WebAssembly, 100% offline)
// Model is downloaded once (~75MB) and cached locally forever.

let pipeline: any = null;
let isLoading = false;
let loadError: string | null = null;

type ProgressCallback = (progress: number, status: string) => void;

export async function loadWhisper(onProgress?: ProgressCallback): Promise<void> {
  if (pipeline) return;
  if (isLoading) return;
  isLoading = true;
  loadError = null;

  try {
    const { pipeline: createPipeline, env } = await import('@xenova/transformers');

    // Cache models in app data, not node_modules
    env.cacheDir = './.voicedeck-models';
    env.allowRemoteModels = true;

    onProgress?.(0, 'Carregando modelo Whisper...');

    pipeline = await createPipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny',
      {
        progress_callback: (info: any) => {
          if (info.status === 'downloading') {
            const pct = Math.round((info.loaded / info.total) * 100);
            onProgress?.(pct, `Baixando modelo: ${pct}%`);
          } else if (info.status === 'loading') {
            onProgress?.(99, 'Inicializando...');
          }
        }
      }
    );

    onProgress?.(100, 'Pronto!');
  } catch (e: any) {
    loadError = e.message;
    isLoading = false;
    throw e;
  }
  isLoading = false;
}

export function isWhisperReady(): boolean {
  return pipeline !== null;
}

export function getWhisperError(): string | null {
  return loadError;
}

// Decode audio blob → Float32Array at 16kHz (required by Whisper)
async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();

  // Mix down to mono
  const channel = decoded.getChannelData(0);
  return channel;
}

export async function transcribeBlob(blob: Blob): Promise<string> {
  if (!pipeline) throw new Error('Whisper not loaded');

  const audio = await blobToFloat32(blob);

  const result = await pipeline(audio, {
    language: 'portuguese',
    task: 'transcribe',
    chunk_length_s: 10,
  });

  return (result.text ?? '').trim();
}
