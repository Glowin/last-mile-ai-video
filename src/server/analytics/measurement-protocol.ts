// GA4 Measurement Protocol sender. Server-only. A no-op unless both
// GA_MEASUREMENT_ID and GA_API_SECRET are set. Never logs the secret or payload.
export type MpConfig = { measurementId: string; apiSecret: string; debugMode: boolean };
export type MpEvent = { name: string; params: Record<string, unknown> };
export type Fetch = typeof fetch;

export function measurementProtocolConfig(env: Record<string, string | undefined> = process.env): MpConfig | null {
  const measurementId = env.GA_MEASUREMENT_ID?.trim();
  const apiSecret = env.GA_API_SECRET?.trim();
  if (!measurementId || !/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret) return null;
  return { measurementId, apiSecret, debugMode: env.GA_MP_DEBUG === "true" };
}

export const GA_CLIENT_ID = /^\d{1,12}\.\d{1,12}$/;

export function mpBody(clientId: string, events: MpEvent[], config: MpConfig, timestampMicros?: number) {
  return {
    client_id: clientId,
    ...(timestampMicros ? { timestamp_micros: timestampMicros } : {}),
    non_personalized_ads: true,
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    events: events.map((e) => ({
      name: e.name,
      params: { engagement_time_msec: 1, ...e.params, ...(config.debugMode ? { debug_mode: 1 } : {}) },
    })),
  };
}

/** Returns true when GA accepted the request (2xx). GA does not validate payloads here. */
export async function sendMeasurementProtocol(
  config: MpConfig, clientId: string, events: MpEvent[], options: { timestampMicros?: number; fetchImpl?: Fetch } = {},
): Promise<boolean> {
  if (!GA_CLIENT_ID.test(clientId)) return false;
  const url = new URL("https://www.google-analytics.com/mp/collect");
  url.searchParams.set("measurement_id", config.measurementId);
  url.searchParams.set("api_secret", config.apiSecret);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mpBody(clientId, events, config, options.timestampMicros)),
    signal: AbortSignal.timeout(5_000),
  });
  return response.status >= 200 && response.status < 300;
}
