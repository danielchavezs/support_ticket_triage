export type FeatureError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type FeatureResult<T> =
  | { success: true; data: T }
  | { success: false; error: FeatureError };

export function ok<T>(data: T): FeatureResult<T> {
  return { success: true, data };
}

export function fail(code: string, message: string, details?: Record<string, unknown>): FeatureResult<never> {
  return { success: false, error: { code, message, details } };
}

