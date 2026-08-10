import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Music, Key, CheckCircle2, XCircle, Minus, X, RefreshCw, SkipForward, SkipBack, Play, Pause, Volume2 } from 'lucide-react';
import { getAuthUrl, getTokens } from './spotify/auth';
import './index.css';

const App = () => {
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [pttStatus, setPttStatus] = useState<'idle' | 'listening' | 'processing' | 'success' | 'error'>('idle');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('default');
  const [micVolume, setMicVolume] = useState<number>(0);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [recognizerReady, setRecognizerReady] = useState(false);
  const [recognizerError, setRecognizerError] = useState<string | null>(null);
  
  const recognizerRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);

  // -- INIT SPEECH RECOGNIZER --
  useEffect(() => {
    import('./commands/speech').then(({ SpeechRecognizer }) => {
      const r = new SpeechRecognizer();
      recognizerRef.current = r;
      if (r.isAvailable) {
        setRecognizerReady(true);
      } else {
        setRecognizerError('Reconhecimento de voz não disponível neste sistema.');
      }
    });
  }, []);

  // -- POLL CURRENTLY PLAYING --
  useEffect(() => {
    if (!spotifyConnected) return;
    
    const fetchTrack = async () => {
      try {
        const { SpotifyAPI } = await import('./spotify/api');
        const res = await SpotifyAPI.getCurrentlyPlaying();
        if (res?.item) setCurrentTrack(res.item);
      } catch (e: any) {
        if (e.message === 'SPOTIFY_TOKEN_EXPIRED') {
          setSpotifyConnected(false);
        }
      }
    };

    fetchTrack();
    const interval = setInterval(fetchTrack, 5000);
    return () => clearInterval(interval);
  }, [spotifyConnected]);

  // -- MIC VOLUME ANALYZER --
  useEffect(() => {
    let active = true;

    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDevice === 'default' ? true : { deviceId: { exact: selectedDevice } }
        });

        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }

        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!active) return;
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setMicVolume(avg);
          animFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        console.error('Mic setup error:', err);
      }
    };

    setup();
    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
      audioContextRef.current?.close();
    };
  }, [selectedDevice]);

  // -- LOAD AUDIO DEVICES --
  useEffect(() => {
    (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      } catch (e) {
        console.error('Could not list devices:', e);
      }
    })();
    
    if (localStorage.getItem('spotify_access_token')) setSpotifyConnected(true);
  }, []);

  // -- COMMAND EXECUTION --
  const executeCommand = useCallback(async (transcription: string) => {
    setLastCommand(transcription);
    setPttStatus('processing');
    setLastAction(null);
    setErrorMsg(null);

    const { parseCommand } = await import('./commands/engine');
    const command = parseCommand(transcription);

    if (!localStorage.getItem('spotify_access_token')) {
      setErrorMsg('Spotify não conectado!');
      setPttStatus('error');
      return;
    }

    try {
      const { SpotifyAPI } = await import('./spotify/api');
      let actionLabel = '';

      switch (command.type) {
        case 'PLAY':
          await SpotifyAPI.play();
          actionLabel = 'Reproduzindo';
          break;
        case 'PAUSE':
          await SpotifyAPI.pause();
          actionLabel = 'Pausado';
          break;
        case 'NEXT_TRACK':
          await SpotifyAPI.next();
          actionLabel = 'Próxima faixa ⏭';
          // Refresh track
          setTimeout(async () => {
            const res = await SpotifyAPI.getCurrentlyPlaying();
            if (res?.item) setCurrentTrack(res.item);
          }, 1000);
          break;
        case 'PREVIOUS_TRACK':
          await SpotifyAPI.previous();
          actionLabel = 'Faixa anterior ⏮';
          setTimeout(async () => {
            const res = await SpotifyAPI.getCurrentlyPlaying();
            if (res?.item) setCurrentTrack(res.item);
          }, 1000);
          break;
        case 'SET_VOLUME':
          await SpotifyAPI.setVolume(command.value);
          actionLabel = `Volume → ${command.value}%`;
          break;
        case 'PLAY_SEARCH':
          const track = await SpotifyAPI.searchAndPlay(command.query);
          actionLabel = `Tocando: ${track.name} — ${track.artists?.[0]?.name}`;
          setTimeout(async () => {
            const res = await SpotifyAPI.getCurrentlyPlaying();
            if (res?.item) setCurrentTrack(res.item);
          }, 1500);
          break;
        default:
          setErrorMsg(`Não entendi: "${transcription}"`);
          setPttStatus('error');
          return;
      }

      setLastAction(actionLabel);
      setPttStatus('success');
    } catch (e: any) {
      console.error('Command failed:', e);
      if (e.message === 'SPOTIFY_NO_ACTIVE_DEVICE') {
        setErrorMsg('Nenhum dispositivo Spotify ativo. Abra o Spotify e reproduza uma música.');
      } else if (e.message === 'SPOTIFY_TOKEN_EXPIRED') {
        setErrorMsg('Sessão expirada. Reconecte o Spotify.');
        setSpotifyConnected(false);
      } else {
        setErrorMsg(`Erro: ${e.message}`);
      }
      setPttStatus('error');
    }
  }, []);

  // -- PTT HANDLERS --
  const startListening = useCallback(() => {
    if (isListeningRef.current || !recognizerRef.current?.isAvailable) return;
    isListeningRef.current = true;
    setIsListening(true);
    setPttStatus('listening');
    setLastCommand(null);
    setLastAction(null);
    setErrorMsg(null);

    recognizerRef.current.start(
      (text: string) => { executeCommand(text); },
      (err: string) => {
        setErrorMsg(`Erro de microfone: ${err}`);
        setPttStatus('error');
        isListeningRef.current = false;
        setIsListening(false);
      }
    );
  }, [executeCommand]);

  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    setIsListening(false);
    recognizerRef.current?.stop();
    if (pttStatus === 'listening') setPttStatus('idle');
  }, [pttStatus]);

  // -- KEYBOARD HANDLER (J key) --
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'j' && !e.repeat) startListening();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'j') stopListening();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [startListening, stopListening]);

  // -- SPOTIFY AUTH --
  const handleSpotifyConnect = async () => {
    if (spotifyConnected) {
      localStorage.removeItem('spotify_access_token');
      localStorage.removeItem('spotify_refresh_token');
      setSpotifyConnected(false);
      setCurrentTrack(null);
      return;
    }
    try {
      const { url, verifier } = await getAuthUrl();
      const code = await window.electron.spotifyAuth(url);
      const tokens = await getTokens(code, verifier);
      localStorage.setItem('spotify_access_token', tokens.access_token);
      localStorage.setItem('spotify_refresh_token', tokens.refresh_token);
      setSpotifyConnected(true);
    } catch (e) {
      console.error('Spotify auth failed:', e);
    }
  };

  // -- UI HELPERS --
  const volPct = Math.min(100, (micVolume / 100) * 100);
  
  const statusColors: Record<string, string> = {
    idle: 'rgba(255,255,255,0.04)',
    listening: 'rgba(0,200,100,0.08)',
    processing: 'rgba(100,120,255,0.08)',
    success: 'rgba(29,185,84,0.08)',
    error: 'rgba(255,60,60,0.08)',
  };

  const statusBorder: Record<string, string> = {
    idle: 'rgba(255,255,255,0.06)',
    listening: 'rgba(0,200,100,0.4)',
    processing: 'rgba(100,120,255,0.4)',
    success: 'rgba(29,185,84,0.4)',
    error: 'rgba(255,60,60,0.4)',
  };

  return (
    <div className="dashboard">
      {/* TITLE BAR (draggable) */}
      <div className="titlebar" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="titlebar-icon">🎙</div>
        <span className="titlebar-name">VoiceDeck</span>
        <div className="titlebar-controls" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button className="ctrl-btn" onClick={() => window.electron?.minimize?.()}>
            <Minus size={12} />
          </button>
          <button className="ctrl-btn close" onClick={() => window.electron?.closeWindow?.()}>
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="content">

        {/* CURRENTLY PLAYING */}
        {spotifyConnected && (
          <div className="now-playing-card glass-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="now-playing-icon">
                <Music size={20} color="#1db954" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>TOCANDO AGORA</div>
                {currentTrack ? (
                  <>
                    <div className="track-name">{currentTrack.name}</div>
                    <div className="track-artist">{currentTrack.artists?.map((a: any) => a.name).join(', ')}</div>
                  </>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma música tocando</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MIC SECTION */}
        <div className="glass-panel section">
          <div className="section-label">
            <Mic size={13} style={{ marginRight: '6px', opacity: 0.7 }} />
            MICROFONE
          </div>
          
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="mic-select"
          >
            {audioDevices.length === 0 && (
              <option value="default">Microfone Padrão</option>
            )}
            {audioDevices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microfone (${d.deviceId.slice(0, 8)}...)`}
              </option>
            ))}
          </select>
          
          {/* Volume meter */}
          <div className="vol-meter-bg">
            <div 
              className="vol-meter-fill"
              style={{ 
                width: `${volPct}%`,
                background: volPct > 70 ? '#ff5f57' : volPct > 40 ? '#ffbd2e' : 'var(--accent)',
              }}
            />
          </div>
          <div className="section-hint">
            {recognizerError 
              ? <span style={{ color: '#ff5f57' }}>⚠ {recognizerError}</span>
              : recognizerReady 
                ? <span style={{ color: '#1db954' }}>✓ Pronto para ouvir</span>
                : 'Carregando...'
            }
          </div>
        </div>

        {/* SPOTIFY SECTION */}
        <div className="glass-panel section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-label" style={{ margin: 0 }}>
              <Music size={13} style={{ marginRight: '6px', opacity: 0.7 }} />
              SPOTIFY
            </div>
            <button className={`spotify-btn ${spotifyConnected ? 'connected' : ''}`} onClick={handleSpotifyConnect}>
              {spotifyConnected ? 'Desconectar' : 'Conectar'}
            </button>
          </div>
          {spotifyConnected && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#1db954' }}>✓ Conta conectada</div>
          )}
        </div>

        {/* PTT SECTION */}
        <div className="glass-panel section">
          <div className="section-label">
            <Key size={13} style={{ marginRight: '6px', opacity: 0.7 }} />
            PUSH-TO-TALK
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <kbd className="kbd">J</kbd>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Segure e fale (janela ativa)</span>
          </div>
        </div>

        {/* COMMAND PANEL */}
        <div 
          className="command-panel"
          style={{ 
            background: statusColors[pttStatus],
            borderColor: statusBorder[pttStatus],
          }}
        >
          {pttStatus === 'listening' && (
            <div className="listening-state">
              <div className="pulse-ring" />
              <Mic size={28} color="#00c864" />
              <div className="listening-text">Ouvindo...</div>
            </div>
          )}

          {pttStatus === 'processing' && (
            <div className="listening-state">
              <RefreshCw size={24} color="#7884ff" className="spinning" />
              <div style={{ marginTop: '8px', color: '#7884ff', fontSize: '14px' }}>Processando...</div>
              {lastCommand && <div className="heard-text">"{lastCommand}"</div>}
            </div>
          )}

          {(pttStatus === 'success') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div className="heard-text">"{lastCommand}"</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#1db954', fontSize: '14px' }}>
                <CheckCircle2 size={16} />
                {lastAction}
              </div>
            </div>
          )}

          {(pttStatus === 'error') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {lastCommand && <div className="heard-text">"{lastCommand}"</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ff5f57', fontSize: '13px' }}>
                <XCircle size={16} />
                {errorMsg}
              </div>
            </div>
          )}

          {pttStatus === 'idle' && (
            <div className="idle-hint">
              <Mic size={30} opacity={0.2} />
              <div>Segure <strong>J</strong> e fale um comando</div>
              <div style={{ fontSize: '12px', opacity: 0.5 }}>Ex: "Próxima música", "Toca Linkin Park"</div>
            </div>
          )}
        </div>

        {/* QUICK COMMANDS REFERENCE */}
        <div className="commands-ref glass-panel">
          <div className="section-label" style={{ marginBottom: '8px' }}>COMANDOS</div>
          <div className="cmd-grid">
            {[
              ['Próxima', '⏭'], ['Anterior', '⏮'],
              ['Pausa / Toca', '⏯'], ['Volume 80', '🔊'],
              ['Toca [música]', '🔍'], ['Continua', '▶'],
            ].map(([cmd, icon]) => (
              <div key={cmd} className="cmd-chip">
                <span>{icon}</span> {cmd}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
