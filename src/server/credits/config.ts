/** Release gate: change only after real delivery acceptance. Never enabled by an environment variable. */
export const GENERATION_CHARGING_ENABLED = false;
export type CreditEnvironment = "test" | "live";
export type ChargingPolicy = { enabled: boolean; environment: CreditEnvironment };
export const productionChargingPolicy: ChargingPolicy = Object.freeze({ enabled: GENERATION_CHARGING_ENABLED, environment: "live" });
