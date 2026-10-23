export interface User {
  id: number;
  username: string;
  display_name?: string | null;
}

export interface DemoLogin {
  enabled: boolean;
  username?: string;
  password?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface Conversation {
  id?: number;
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

export interface Transcription {
  id?: number;
  realtime?: boolean;
  utterances?: Utterance[];
}

export interface Location {
  address?: string | null;
  latitude?: number;
  longitude?: number;
}

export interface ConversationDetail extends Conversation {
  primary_location?: Location | null;
  suggested_links?: Array<{ url?: string; created_at?: number }> | null;
  transcriptions?: Transcription[] | null;
  stale: boolean;
}

export interface DailySummary {
  bee_id: number;
  day?: string | null;
  day_time?: string | null;
  short_summary?: string | null;
  summary?: string | null;
  email_summary?: string | null;
  calendar_summary?: string | null;
  conversations_count?: number | null;
  locations?: Location[] | null;
  synced_at: string;
}

export interface Fact {
  bee_id: number;
  text: string;
  tags?: string[] | null;
  confirmed: boolean;
  origin?: string;
  source_kind?: string | null;
  source_conversation_id?: number | null;
  source_conversation_bee_id?: number | null;
  source_excerpt?: string | null;
  ai_generated?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  bee_created_at?: string | null;
  synced_at: string;
}

export interface Todo {
  bee_id: number;
  text: string;
  completed: boolean;
  alarm_at?: string | null;
  origin?: string;
  source_conversation_id?: number | null;
  source_conversation_bee_id?: number | null;
  source_excerpt?: string | null;
  due_at?: string | null;
  postponed_until?: string | null;
  ai_generated?: boolean;
  approved?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  bee_created_at?: string | null;
  synced_at: string;
}

export interface ActivityItem {
  kind: "conversation" | "daily" | "fact" | "todo" | string;
  bee_id: number;
  title: string;
  subtitle?: string | null;
  occurred_at?: string | null;
}

export interface SyncRun {
  id: number;
  trigger: string;
  status: "running" | "success" | "failed" | string;
  mode: string;
  started_at: string;
  finished_at?: string | null;
  counts?: Record<string, Record<string, number>> | null;
  error?: string | null;
}

export interface SyncStatus {
  last_synced_at?: string | null;
  last_full_sync_at?: string | null;
  cursor_present: boolean;
  running: boolean;
  last_run?: SyncRun | null;
}

export interface Connection {
  configured: boolean;
  mode: string;
  base_url: string;
  reachable: boolean;
  account?: Record<string, string | number | boolean | null> | null;
  error?: string | null;
  sync: SyncStatus;
}

export interface Overview {
  counts: Record<string, number>;
  sync: SyncStatus;
  today_summary?: DailySummary | null;
  recent_conversations: Conversation[];
  open_todos: Todo[];
  recent_facts: Fact[];
  recent_activity: ActivityItem[];
}

export interface SearchResponse {
  query: string;
  mode: string;
  filter: string;
  results: Array<Record<string, unknown>>;
  total?: number | null;
}

export interface PrivacySummary {
  stored: Record<string, number>;
  retention: string;
  credentials: string;
  sources: string[];
}

export interface DeleteResult {
  deleted: Record<string, number>;
  message: string;
}

export interface MobileDevice {
  id: number;
  device_name: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  revoked_at?: string | null;
}

/* ------------------------------------------------------------- Phase 2 AI */

export interface WakeWordStatus {
  phrase: string;
  engine: string;
  available: boolean;
  local_engine_bundled: boolean;
}

export interface AssistantStatus {
  provider: string;
  configured: boolean;
  base_url: string;
  model: string;
  stt_model: string;
  tts_model: string;
  tts_voice: string;
  timeout_seconds: number;
  max_context_sources: number;
  rate_limit_per_minute: number;
  max_audio_bytes: number;
  wake_word: WakeWordStatus;
  retrieval: { mode: string; embeddings: boolean; note: string };
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

export interface Meeting {
  id: number;
  conversation_id?: number | null;
  conversation_bee_id?: number | null;
  title: string;
  meeting_at?: string | null;
  participants?: string[] | null;
  summary?: string | null;
  key_points?: string[] | null;
  decisions?: string[] | null;
  action_items?: Array<{ text: string; due_at?: string | null }> | null;
  source_kind: string;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface LearningItem {
  id: number;
  set_id: number;
  kind: "flashcard" | "quiz" | string;
  question: string;
  answer: string;
  explanation?: string | null;
  status: string;
  reviews: number;
  last_reviewed_at?: string | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface LearningSet {
  id: number;
  title: string;
  source_kind: string;
  conversation_id?: number | null;
  conversation_bee_id?: number | null;
  notes?: string | null;
  goals?: string[] | null;
  revision_plan?: string[] | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface LearningDetail extends LearningSet {
  items: LearningItem[];
}

export interface InsightTrend {
  label: string;
  current: number;
  previous: number;
  delta: number;
  direction: "up" | "down" | "flat" | string;
  basis: string;
}

export interface Insights {
  period: "day" | "week" | string;
  start: string;
  end: string;
  sufficient_data: boolean;
  counts: Record<string, number>;
  recent_summaries: DailySummary[];
  conversations: Array<Conversation & { route: string }>;
  tasks: {
    completed: Todo[];
    pending: Todo[];
    due_soon: Todo[];
    overdue: Todo[];
  };
  decisions: Array<Record<string, unknown>>;
  commitments: Array<Record<string, unknown>>;
  project_activity: Array<Record<string, unknown>>;
  trends: InsightTrend[];
  notes: string;
  generated_at: string;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  route: string;
  verified: boolean;
  source?: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  derived: boolean;
  confidence: number;
  source_ref?: string | null;
  label?: string | null;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated_at: string;
  note: string;
}

export interface LocalSearchResponse {
  mode: string;
  query: string;
  items: ContextSource[];
  note: string;
}

export interface ExtractCandidate {
  text: string;
  tags?: string[];
  confidence: number;
  excerpt?: string | null;
  source_kind?: string;
  source_conversation_id?: number;
  conversation_bee_id?: number;
  dedupe_key?: string;
  origin?: string;
  due_at?: string | null;
  duplicate?: boolean;
}
