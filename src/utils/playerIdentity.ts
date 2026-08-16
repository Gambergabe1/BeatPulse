export function getPlayerId() {
  const storageKey = 'beatpulse_player_id';
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(storageKey, id);
  }
  return id;
}

export function getPlayerToken() {
  const storageKey = 'beatpulse_player_token';
  let token = localStorage.getItem(storageKey);
  if (!token) {
    token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, token);
  }
  return token;
}
