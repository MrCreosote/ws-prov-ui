const AUTH_URL = 'https://kbase.us/services/auth/api/V2/token';

export async function getCurrentUser(token: string): Promise<string> {
  const res = await fetch(AUTH_URL, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`Auth error: ${res.status}`);
  const json = await res.json();
  return json.user as string;
}
