const API_BASE = 'https://api.spotify.com/v1';

async function request(endpoint: string, method: string = 'GET', body?: any) {
  const token = localStorage.getItem('spotify_access_token');
  if (!token) throw new Error('Not authenticated with Spotify');

  const hasBody = body !== undefined && body !== null;
  const bodyStr = hasBody ? JSON.stringify(body) : null;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  };

  if (hasBody && bodyStr) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(new TextEncoder().encode(bodyStr).length);
  } else {
    // Explicit zero Content-Length prevents chunked transfer on empty PUT/POST
    headers['Content-Length'] = '0';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: bodyStr,
  });

  if (response.status === 401) throw new Error('SPOTIFY_TOKEN_EXPIRED');
  if (response.status === 404) throw new Error('SPOTIFY_NO_ACTIVE_DEVICE');
  if (response.status === 403) throw new Error('SPOTIFY_FORBIDDEN');
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const SpotifyAPI = {
  play:     () => request('/me/player/play', 'PUT'),
  pause:    () => request('/me/player/pause', 'PUT'),
  next:     () => request('/me/player/next', 'POST'),
  previous: () => request('/me/player/previous', 'POST'),
  setVolume: (vol: number) =>
    request(`/me/player/volume?volume_percent=${Math.min(100, Math.max(0, vol))}`, 'PUT'),
  getCurrentlyPlaying: () => request('/me/player/currently-playing', 'GET'),
  searchAndPlay: async (query: string) => {
    const res = await request(`/search?q=${encodeURIComponent(query)}&type=track&limit=1`);
    const track = res?.tracks?.items?.[0];
    if (!track) throw new Error('Track not found');
    await request('/me/player/play', 'PUT', { uris: [track.uri] });
    return track;
  },
};
