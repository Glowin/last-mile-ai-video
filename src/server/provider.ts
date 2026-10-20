import { z } from "zod";
const taskSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["pending", "success", "failed"]),
  data: z.array(z.object({ url: z.string().url() })).optional(),
});
export type ProviderTask = z.infer<typeof taskSchema>;
export class ProviderError extends Error {
  constructor(public status: number) {
    super("Video service request failed.");
  }
}
export async function providerRequest(
  path: string,
  options: RequestInit = {},
): Promise<ProviderTask> {
  const key = process.env.VIBETOKEN_API_KEY;
  if (!key) throw new ProviderError(503);
  const response = await fetch(
    `https://vibetoken.cn/v1/videos/generations${path}`,
    {
      ...options,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        Authorization: `Bearer ${key}`,
      },
    },
  );
  if (!response.ok) throw new ProviderError(response.status);
  const parsed = taskSchema.safeParse(await response.json());
  if (!parsed.success) throw new ProviderError(502);
  if (
    parsed.data.status === "success" &&
    (!parsed.data.data?.[0] || !safeResultUrl(parsed.data.data[0].url))
  )
    throw new ProviderError(502);
  return parsed.data;
}
export function safeResultUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
