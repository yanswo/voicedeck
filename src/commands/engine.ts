export type Command =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "NEXT_TRACK" }
  | { type: "PREVIOUS_TRACK" }
  | { type: "SET_VOLUME"; value: number }
  | { type: "PLAY_SEARCH"; query: string }
  | { type: "UNKNOWN" };

export function parseCommand(transcription: string): Command {
  const text = transcription.toLowerCase().trim();

  // NEXT
  if (
    text.includes('próxima') || 
    text.includes('passa') || 
    text.includes('pula') || 
    text.includes('troca') ||
    text.includes('next')
  ) {
    return { type: "NEXT_TRACK" };
  }

  // PREVIOUS
  if (
    text.includes('anterior') || 
    text.includes('volta') || 
    text.includes('previous')
  ) {
    return { type: "PREVIOUS_TRACK" };
  }

  // PAUSE
  if (
    text.includes('pausa') || 
    text.includes('para') || 
    text.includes('stop') ||
    text.match(/^pausar/)
  ) {
    return { type: "PAUSE" };
  }

  // SET VOLUME
  const volumeMatch = text.match(/volume (em )?(\d+)/);
  if (volumeMatch && volumeMatch[2]) {
    return { type: "SET_VOLUME", value: parseInt(volumeMatch[2], 10) };
  }
  
  if (text.includes('volume no máximo')) return { type: "SET_VOLUME", value: 100 };
  if (text.includes('volume no mínimo')) return { type: "SET_VOLUME", value: 0 };

  // PLAY SEARCH
  const playSearchMatch = text.match(/(toca|tocar|coloca|colocar) (.+)/);
  if (playSearchMatch && playSearchMatch[2]) {
    // se for apenas "toca" ou "tocar" sem nada, é só PLAY
    const query = playSearchMatch[2].trim();
    if (query === 'música' || query === 'a música' || query === '') {
      return { type: "PLAY" };
    }
    return { type: "PLAY_SEARCH", query };
  }

  // PLAY (Resume)
  if (
    text.includes('toca') || 
    text.includes('continua') || 
    text.includes('play')
  ) {
    return { type: "PLAY" };
  }

  return { type: "UNKNOWN" };
}
