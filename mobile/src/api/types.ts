export interface User {
  id: number;
  username: string;
  display_name?: string | null;
}

export interface MobileDevice {
  id: number;
  device_name: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  revoked_at?: string | null;
}

export interface PairResponse {
  token: string;
  token_type: "Bearer";
  expires_at: string;
  user: User;
  device: MobileDevice;
}

export interface MobileSession {
  user: User;
  device: MobileDevice;
  server_time: string;
  api_version: string;
  capabilities: {
    conversations: boolean;
    summaries: boolean;
    tasks: boolean;
    assistant_chat: boolean;
    assistant_transcribe: boolean;
    bee_sync: boolean;
    updates: "foreground_polling";
    wake_word: { mode: "on_device_optional"; phrase: string };
    audio_output: "os_default_route";
  };
  bee: { configured: boolean; mode: string };
  ai: { configured: boolean; provider: string; model: string };
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface Conversation {
  id?: number | null;
  bee_id: number;
  uuid?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  device_type?: string | null;
  state: string;
  short_summary?: string | null;
  summary?: string | null;
  synced_at: string;
}

export interface Utterance {
  id?: number;
  text?: string;
  speaker?: string;
  spoken_at?: number | null;
  start?: number | null;
  end?: number | null;
}

export interface ConversationDetail extends Conversation {
  primary_location?: Record<string, unknown> | null;
  suggested_links?: unknown[] | null;
  transcriptions?: Array<{ utterances?: Utterance[] }> | null;
  stale?: boolean;
}

export interface DailySummary {
  bee_id: number;
  day?: string | null;
  day_time?: string | null;
  short_summary?: string | null;
  summary?: string | null;
  conversations_count?: number | null;
  synced_at: string;
}

export interface Todo {
  bee_id: number;
  text: string;
  completed: boolean;
  alarm_at?: string | null;
  origin: string;
  source_conversation_bee_id?: number | null;
  due_at?: string | null;
  ai_generated: boolean;
  synced_at: string;
}

export interface ContextSource {
  kind: string;
  ref: string;
  id: number;
  title: string;
  snippet: string;
  occurred_at?: string | null;
  route: string;
  verified: boolean;
  score: number;
  metadata: Record<string, unknown>;
}

export interface ChatResponse {
  answer: string;
  sources: ContextSource[];
  grounded: boolean;
  clarification_needed: boolean;
  model?: string | null;
  generated_at: string;
}

export interface TranscriptResponse {
  text: string;
  model: string;
}

export interface SyncRun {
  id: number;
  mode: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
}

export interface DeleteResult {
  deleted: Record<string, number>;
  message: string;
}

export interface Overview {
  counts: Record<string, number>;
  recent_conversations: Conversation[];
  open_todos: Todo[];
  today_summary?: DailySummary | null;
  sync?: {
    last_synced_at?: string | null;
    last_full_sync_at?: string | null;
    cursor_present?: boolean;
    running?: boolean;
  };
  generated_at: string;
}
