import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Music, Key, Power, CheckCircle2 } from 'lucide-react';
import './index.css';

const App = () => {
  const [isActive, setIsActive] = useState(true);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const toggleSpotify = () => {
    // Simulando conexão para o MVP de UI inicial
    setSpotifyConnected(!spotifyConnected);
  };

  return (
    <div className="dashboard">
      <div className="header">
        <h1 className="title">VoiceDeck</h1>
        <div className={`status-badge ${isActive ? 'active' : 'inactive'}`}>
          <div className="status-indicator"></div>
          {isActive ? 'Ativo' : 'Inativo'}
        </div>
      </div>

      <div className="grid">
        <div className="glass-panel card">
          <div className="card-title">Microfone</div>
          <div className="card-value">
            <Mic size={18} className={isActive ? 'text-accent' : 'text-muted'} />
            Padrão (Sistema)
          </div>
        </div>

        <div className="glass-panel card">
          <div className="card-title">Push-to-Talk</div>
          <div className="card-value">
            <Key size={18} className="text-muted" />
            <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>ALT</kbd>
          </div>
        </div>
      </div>

      <div className="glass-panel card" style={{ marginTop: '4px' }}>
        <div className="card-title">Spotify</div>
        <div className="card-value" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Music size={18} color={spotifyConnected ? '#1db954' : '#a0a0a0'} />
            <span style={{ color: spotifyConnected ? '#1db954' : 'inherit' }}>
              {spotifyConnected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
          <button 
            className={`btn ${spotifyConnected ? '' : 'btn-primary'}`}
            onClick={toggleSpotify}
          >
            {spotifyConnected ? 'Desconectar' : 'Conectar Spotify'}
          </button>
        </div>
      </div>

      <div className="glass-panel command-display">
        {lastCommand ? (
          <>
            <div className="command-text">"{lastCommand}"</div>
            <div className="command-action">
              <CheckCircle2 size={20} />
              {lastAction}
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Mic size={32} opacity={0.5} />
            <div>Segure <strong>ALT</strong> e fale um comando</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>Ex: "Próxima música", "Toca Numb"</div>
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
