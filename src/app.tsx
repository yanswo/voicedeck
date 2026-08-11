import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Music, Key, CheckCircle2, XCircle, Minus, X, RefreshCw, Download } from 'lucide-react';
import { getAuthUrl, getTokens } from './spotify/auth';
import { AudioRecorder } from './commands/recorder';
import './index.css';

type PTTStatus = 'init' | 'loading' | 'idle' | 'listening' | 'processing' | 'success' | 'error';

// Decode blob → Float32Array at 16 kHz for Whisper
async function blobToFloat32At16k(blob: Blob): Promise<ArrayBuffer> {
  const arrBuf = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrBuf);
  ctx.close();
  // Mix to mono and return as ArrayBuffer
  return decoded.getChannelData(0).buffer.slice(0);
}

const App = () => {
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [pttStatus, setPttStatus] = useState<PTTStatus>('init');
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMsg, setLoadMsg] = useState('Iniciando...');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('default');
  const [micVolume, setMicVolume] = useState<number>(0);
  const [currentTrack, setCurrentTrack] = useState<any>(null);

  const recorderRef = useRef(new AudioRecorder());
  const isListeningRef = useRef(false);
  const whisperReadyRef = useRef(false);
  const animFrameRef = useRef<number>(0);

  // Load Whisper via IPC (runs in main process, uses filesystem)
  useEffect(() => {
    setPttStatus('loading');
    setLoadMsg('Carregando Whisper...');

    window.electron.onWhisperProgress((info: any) => {
      if (info.status === 'downloading') {
        const pct = Math.round((info.loaded / info.total) * 100);
        setLoadProgress(pct);
        setLoadMsg(`Baixando modelo: ${pct}%`);
      } else if (info.status === 'loading') {
        setLoadMsg('Inicializando...');
        setLoadProgress(99);
      }
    });

    window.electron.loadWhisper().then((res: any) => {
      if (res.ok) {
        whisperReadyRef.current = true;
        setPttStatus('idle');
        setLoadMsg('Pronto!');
      } else {
        setErrorMsg(`Erro ao carregar: ${res.error}`);
        setPttStatus('error');
      }
    });
  }, []);

  // Poll currently playing track
  useEffect(() => {
    if (!spotifyConnected) return;

    const fetchTrack = async () => {
      try {
        const { SpotifyAPI } = await import('./spotify/api');
        const res = await SpotifyAPI.getCurrentlyPlaying();
        if (res?.item) setCurrentTrack(res.item);
      } catch (e: any) {
        if (e.message === 'SPOTIFY_TOKEN_EXPIRED') setSpotifyConnected(false);
      }
    };

    fetchTrack();
    const interval = setInterval(fetchTrack, 5000);
    return () => clearInterval(interval);
  }, [spotifyConnected]);

  // Mic volume visualizer
  useEffect(() => {
    let active = true;
    let ctx: AudioContext;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDevice === 'default' ? true : { deviceId: { exact: selectedDevice } }
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }

        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!active) return;
          analyser.getByteFrequencyData(data);
          setMicVolume(data.reduce((a, b) => a + b, 0) / data.length);
          animFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    })();

    return () => { active = false; cancelAnimationFrame(animFrameRef.current); ctx?.close(); };
  }, [selectedDevice]);

  // Load devices + spotify state
  useEffect(() => {
    (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const all = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(all.filter(d => d.kind === 'audioinput'));
      } catch {}
    })();
    if (localStorage.getItem('spotify_access_token')) setSpotifyConnected(true);
  }, []);

  // Execute command
  const executeCommand = useCallback(async (transcription: string) => {
    if (!transcription.trim()) {
      setPttStatus('error');
      setErrorMsg('Nada foi ouvido. Fale mais perto do microfone.');
      return;
    }

    setLastCommand(transcription);
    setPttStatus('processing');

    const { parseCommand } = await import('./commands/engine');
    const command = parseCommand(transcription);

    if (!localStorage.getItem('spotify_access_token')) {
      setErrorMsg('Spotify não conectado!');
      setPttStatus('error');
      return;
    }

    try {
      const { SpotifyAPI } = await import('./spotify/api');
      let label = '';

      switch (command.type) {
        case 'PLAY':         await SpotifyAPI.play();    label = 'Reproduzindo ▶'; break;
        case 'PAUSE':        await SpotifyAPI.pause();   label = 'Pausado ⏸'; break;
        case 'NEXT_TRACK':   await SpotifyAPI.next();    label = 'Próxima ⏭';
          setTimeout(async () => { const r = await SpotifyAPI.getCurrentlyPlaying(); if (r?.item) setCurrentTrack(r.item); }, 1500); break;
        case 'PREVIOUS_TRACK': await SpotifyAPI.previous(); label = 'Anterior ⏮';
          setTimeout(async () => { const r = await SpotifyAPI.getCurrentlyPlaying(); if (r?.item) setCurrentTrack(r.item); }, 1500); break;
        case 'SET_VOLUME':   await SpotifyAPI.setVolume(command.value); label = `Volume → ${command.value}%`; break;
        case 'PLAY_SEARCH':
          const track = await SpotifyAPI.searchAndPlay(command.query);
          label = `Tocando: ${track.name} — ${track.artists?.[0]?.name}`;
          setTimeout(async () => { const r = await SpotifyAPI.getCurrentlyPlaying(); if (r?.item) setCurrentTrack(r.item); }, 2000);
          break;
        default:
          setErrorMsg(`Não entendi: "${transcription}". Tente: "próxima", "pausa", "toca [música]"`);
          setPttStatus('error');
          return;
      }

      setLastAction(label);
      setPttStatus('success');
    } catch (e: any) {
      const msgs: Record<string, string> = {
        'SPOTIFY_NO_ACTIVE_DEVICE': 'Nenhum dispositivo Spotify ativo. Abra e toque algo no Spotify primeiro.',
        'SPOTIFY_TOKEN_EXPIRED': 'Sessão expirada. Reconecte o Spotify.',
        'SPOTIFY_FORBIDDEN': 'Spotify Premium necessário.',
      };
      setErrorMsg(msgs[e.message] ?? `Erro: ${e.message}`);
      setPttStatus('error');
    }
  }, []);

  // PTT start
  const startListening = useCallback(async () => {
    if (isListeningRef.current || !whisperReadyRef.current) return;
    isListeningRef.current = true;
    setPttStatus('listening');
    setLastCommand(null);
    setLastAction(null);
    setErrorMsg(null);

    recorderRef.current.setDevice(selectedDevice);
    try {
      await recorderRef.current.start();
    } catch (e: any) {
      isListeningRef.current = false;
      setPttStatus('error');
      setErrorMsg(`Microfone: ${e.message}`);
    }
  }, [selectedDevice]);

  // PTT stop → transcribe
  const stopListening = useCallback(async () => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    setPttStatus('processing');

    try {
      const blob = await recorderRef.current.stop();

      if (!blob) {
        setPttStatus('error');
        setErrorMsg('Gravação muito curta. Segure J e fale antes de soltar.');
        return;
      }

      // Decode on renderer, send Float32 to main process
      const float32Buf = await blobToFloat32At16k(blob);
      const res = await window.electron.transcribe(float32Buf);

      if (!res.ok) {
        setPttStatus('error');
        setErrorMsg(`Erro de transcrição: ${res.error}`);
        return;
      }

      await executeCommand(res.text ?? '');
    } catch (e: any) {
      setPttStatus('error');
      setErrorMsg(`Erro: ${e.message}`);
    }
  }, [executeCommand]);

  // Keyboard: J key
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'j' && !e.repeat) startListening(); };
    const onUp   = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'j') stopListening(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [startListening, stopListening]);

  // Spotify Auth
  const handleSpotifyConnect = async () => {
    if (spotifyConnected) {
      localStorage.removeItem('spotify_access_token');
      localStorage.removeItem('spotify_refresh_token');
      setSpotifyConnected(false); setCurrentTrack(null); return;
    }
    try {
      setErrorMsg(null);
      const { url, verifier } = await getAuthUrl();
      const code = await window.electron.spotifyAuth(url);
      const tokens = await getTokens(code, verifier);
      localStorage.setItem('spotify_access_token', tokens.access_token);
      localStorage.setItem('spotify_refresh_token', tokens.refresh_token);
      setSpotifyConnected(true);
    } catch (e: any) {
      console.error('Spotify auth error:', e);
      setPttStatus('error');
      setErrorMsg(`Falha ao conectar no Spotify: ${e.message || e}`);
    }
  };

  // Helpers
  const volPct = Math.min(100, (micVolume / 80) * 100);
  const dotColor = { init: 'yellow', loading: 'purple', idle: 'green', listening: 'green', processing: 'yellow', success: 'green', error: 'red' }[pttStatus];
  const panelBg:  Record<string, string> = { init: 'rgba(255,255,255,0.03)', loading: 'rgba(124,77,255,0.05)', idle: 'rgba(255,255,255,0.03)', listening: 'rgba(0,200,100,0.07)', processing: 'rgba(100,120,255,0.07)', success: 'rgba(29,185,84,0.07)', error: 'rgba(255,60,60,0.07)' };
  const panelBdr: Record<string, string> = { init: 'rgba(255,255,255,0.06)', loading: 'rgba(124,77,255,0.3)', idle: 'rgba(255,255,255,0.06)', listening: 'rgba(0,200,100,0.4)', processing: 'rgba(100,120,255,0.4)', success: 'rgba(29,185,84,0.4)', error: 'rgba(255,60,60,0.4)' };

  return (
    <div className="dashboard">
      {/* TITLEBAR */}
      <div className="titlebar" style={{ WebkitAppRegion: 'drag' } as any}>
        <span className="titlebar-icon">🎙</span>
        <span className="titlebar-name">VoiceDeck</span>
        <div className={`status-dot ${dotColor}`} style={{ marginLeft: '6px' }} />
        <div className="titlebar-controls" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button className="ctrl-btn" onClick={() => window.electron?.minimize?.()}><Minus size={12} /></button>
          <button className="ctrl-btn close" onClick={() => window.electron?.closeWindow?.()}><X size={12} /></button>
        </div>
      </div>

      <div className="content">
        {/* NOW PLAYING */}
        {spotifyConnected && (
          <div className="now-playing-card glass-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="now-playing-icon"><Music size={20} color="#1db954" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px', letterSpacing: '0.8px' }}>TOCANDO AGORA</div>
                {currentTrack ? (
                  <>
                    <div className="track-name">{currentTrack.name}</div>
                    <div className="track-artist">{currentTrack.artists?.map((a: any) => a.name).join(', ')}</div>
                  </>
                ) : <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma música tocando</div>}
              </div>
            </div>
          </div>
        )}

        {/* MIC */}
        <div className="glass-panel section">
          <div className="section-label"><Mic size={12} style={{ marginRight: '5px' }} />MICROFONE</div>
          <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} className="mic-select">
            {audioDevices.length === 0
              ? <option value="default">Microfone Padrão</option>
              : audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone (${d.deviceId.slice(0,8)})`}</option>)
            }
          </select>
          <div className="vol-meter-bg">
            <div className="vol-meter-fill" style={{ width: `${volPct}%`, background: volPct > 75 ? '#ff5f57' : volPct > 45 ? '#ffbd2e' : 'var(--accent2)' }} />
          </div>
        </div>

        {/* SPOTIFY */}
        <div className="glass-panel section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-label" style={{ margin: 0 }}><Music size={12} style={{ marginRight: '5px' }} />SPOTIFY</div>
            <button className={`spotify-btn ${spotifyConnected ? 'connected' : ''}`} onClick={handleSpotifyConnect}>
              {spotifyConnected ? '✓ Conectado' : 'Conectar'}
            </button>
          </div>
        </div>

        {/* PTT */}
        <div className="glass-panel section" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Key size={14} color="var(--text-muted)" />
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Segure <kbd className="kbd">J</kbd> e fale</span>
            <div style={{ marginLeft: 'auto' }}><div className="mode-badge active" style={{ fontSize: '10px' }}>🤖 Whisper Local</div></div>
          </div>
        </div>

        {/* COMMAND PANEL */}
        <div className="command-panel" style={{ background: panelBg[pttStatus], borderColor: panelBdr[pttStatus] }}>

          {(pttStatus === 'init' || pttStatus === 'loading') && (
            <div className="listening-state">
              <Download size={22} color="#7c4dff" className="spinning" />
              <div style={{ color: '#a57bff', fontSize: '13px', marginTop: '6px', textAlign: 'center' }}>{loadMsg}</div>
              {loadProgress > 0 && loadProgress < 100 && (
                <div style={{ width: '160px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', marginTop: '8px' }}>
                  <div style={{ width: `${loadProgress}%`, height: '100%', background: '#7c4dff', transition: 'width 0.3s' }} />
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', opacity: 0.6 }}>
                {loadProgress === 0 ? 'Verificando cache...' : `Baixando modelo Whisper... ${loadProgress}%`}
              </div>
            </div>
          )}

          {pttStatus === 'listening' && (
            <div className="listening-state">
              <div className="pulse-ring" />
              <Mic size={26} color="#00c864" />
              <div className="listening-text">Ouvindo...</div>
              <div style={{ fontSize: '11px', color: '#00c864', opacity: 0.7 }}>Solte J para processar</div>
            </div>
          )}

          {pttStatus === 'processing' && (
            <div className="listening-state">
              <RefreshCw size={22} color="#7884ff" className="spinning" />
              <div style={{ color: '#7884ff', fontSize: '14px', marginTop: '6px' }}>Transcrevendo...</div>
            </div>
          )}

          {pttStatus === 'success' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <div className="heard-text">"{lastCommand}"</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#1db954', fontSize: '13px' }}>
                <CheckCircle2 size={15} /> {lastAction}
              </div>
            </div>
          )}

          {pttStatus === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              {lastCommand && <div className="heard-text">"{lastCommand}"</div>}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: '#ff5f57', fontSize: '12px' }}>
                <XCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> {errorMsg}
              </div>
              <button className="spotify-btn" style={{ marginTop: '4px', fontSize: '11px' }} onClick={() => setPttStatus('idle')}>
                Tentar novamente
              </button>
            </div>
          )}

          {pttStatus === 'idle' && (
            <div className="idle-hint">
              <Mic size={28} opacity={0.2} />
              <div>Segure <strong>J</strong> e fale um comando</div>
              <div style={{ fontSize: '12px', opacity: 0.5 }}>100% local · 100% gratuito</div>
            </div>
          )}
        </div>

        {/* COMMANDS REFERENCE */}
        <div className="commands-ref glass-panel">
          <div className="section-label" style={{ marginBottom: '8px' }}>EXEMPLOS</div>
          <div className="cmd-grid">
            {['⏭ Próxima música','⏮ Música anterior','⏸ Pausa','▶ Toca / Continua','🔊 Volume 70','🔍 Toca Linkin Park'].map(cmd => (
              <div key={cmd} className="cmd-chip">{cmd}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
