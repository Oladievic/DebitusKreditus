export type LocalAITopic = 'overview' | 'payment' | 'documents';

export type LocalAIState =
  | 'ready'
  | 'disabled'
  | 'cloud'
  | 'offline'
  | 'no_model'
  | 'unsupported_model'
  | 'low_memory'
  | 'busy'
  | 'config_error';

export interface LocalAIStatus {
  state: LocalAIState;
  available: boolean;
  runtime: 'local' | 'cloud';
  model: string | null;
  message: string;
  limits: { contextTokens: number; outputTokens: number; timeoutSeconds: number; concurrency: 1 };
  modelInfo?: { digest: string; sizeBytes: number; quantization: string; license: 'Apache-2.0' };
}

export interface LocalAIExplanation {
  text: string;
  method: 'verified-fact-selection-v1';
  selectedFactIds: string[];
  model: string;
  modelDigest: string;
  topic: LocalAITopic;
  applicationId: string;
  applicationVersion: number;
  profileVersion: number;
  assessmentVersion: string;
  generatedAt: string;
  truncated: boolean;
}
