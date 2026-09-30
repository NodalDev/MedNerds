import { configuredRealtimeOrigin, publicRealtimeOrigin } from './realtime-url';

const configuredWorkerUrl = import.meta.env.PUBLIC_MEDCASES_REALTIME_URL?.trim();
const configuredJoinBaseUrl = import.meta.env.PUBLIC_MEDCASES_JOIN_BASE_URL?.trim();

/** Production has no localhost fallback; an invalid URL leaves live features disabled. */
export const realtimeConfig = {
  workerUrl: configuredRealtimeOrigin(configuredWorkerUrl, import.meta.env.DEV),
  joinBaseUrl: publicRealtimeOrigin(configuredJoinBaseUrl, import.meta.env.DEV),
};

if (import.meta.env.PROD && !realtimeConfig.workerUrl && typeof window !== 'undefined') {
  console.error('MedCases Realtime ist nicht konfiguriert: PUBLIC_MEDCASES_REALTIME_URL benötigt eine HTTPS-Origin.');
}
