export const SPOTIFY_CLIENT_ID = '9712ffae00024ca2b0d773637cd97c44';
export const REDIRECT_URI = 'http://127.0.0.1:1420/callback';
const SCOPES = ['user-modify-playback-state', 'user-read-playback-state', 'user-read-currently-playing'];

export function generateRandomString(length: number): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function getAuthUrl(): Promise<{ url: string, verifier: string }> {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
  });

  return {
    url: `https://accounts.spotify.com/authorize?${params.toString()}`,
    verifier
  };
}

export async function getTokens(code: string, verifier: string) {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch tokens');
  }

  return response.json(); // { access_token, refresh_token, expires_in }
}
