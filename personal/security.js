const enc = new TextEncoder();
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const base64 = value => {
  const bytes = new Uint8Array(value); let text='';
  for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
};
async function hmac(key, value) {
  const imported = await crypto.subtle.importKey('raw', key, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, enc.encode(value)));
}
export async function authenticate(initData, botToken, now = Date.now()) {
  if (typeof initData !== 'string' || initData.length > 16000 || !botToken) throw new Error('UNAUTHORIZED');
  const params = new URLSearchParams(initData);
  const names = [...params.keys()];
  if (new Set(names).size !== names.length) throw new Error('UNAUTHORIZED');
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash ?? '')) throw new Error('UNAUTHORIZED');
  params.delete('hash');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const actual = await hmac(secret, [...params].sort(([a],[b]) => a<b?-1:a>b?1:0).map(([k,v]) => `${k}=${v}`).join('\n'));
  const expected = Uint8Array.from(hash.match(/../g), s => parseInt(s,16));
  let diff = 0; for(let i=0;i<32;i++) diff |= actual[i] ^ expected[i];
  const age = Math.floor(now/1000) - Number(params.get('auth_date'));
  if (diff || !Number.isFinite(age) || age < -30 || age > 600) throw new Error('UNAUTHORIZED');
  let user; try { user = JSON.parse(params.get('user')); } catch { throw new Error('UNAUTHORIZED'); }
  const kind = params.get('chat_type');
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.is_bot || (kind && !['sender','private'].includes(kind))) throw new Error('UNAUTHORIZED');
  return user.id;
}
async function key(value) {
  let raw; try { raw = bytes(value); } catch { throw new Error('SERVER_CONFIG'); }
  if (raw.length !== 32) throw new Error('SERVER_CONFIG');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(value, tgId, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:enc.encode(`kntu-personal:v1:${tgId}`) }, await key(secret), enc.encode(JSON.stringify(value)));
  return `v1.${base64(iv)}.${base64(encrypted)}`;
}
export async function unseal(value, tgId, secret) {
  const [version,iv,data] = String(value).split('.');
  if (version !== 'v1') throw new Error('VAULT_ERROR');
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:bytes(iv), additionalData:enc.encode(`kntu-personal:v1:${tgId}`) }, await key(secret), bytes(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
