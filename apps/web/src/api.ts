const BASE = window.location.origin;

export async function verifyPairing(code: string, deviceId?: string): Promise<string> {
  const body: Record<string, string> = { code };
  if (deviceId) body.deviceId = deviceId;
  const res = await fetch(`${BASE}/api/pairing/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Verification failed' }));
    throw new Error(err.error || 'Verification failed');
  }
  const data = await res.json();
  return data.token;
}

export async function getStatus(): Promise<{ status: string; timestamp: string }> {
  const res = await fetch(`${BASE}/api/status`);
  return res.json();
}
