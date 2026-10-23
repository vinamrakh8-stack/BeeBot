import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  ApiError,
  createApiClient,
  errorMessage,
  isInsecureBaseUrl,
  normalizeBaseUrl,
  type ApiClient,
} from "./src/api/client";
import type {
  ChatResponse,
  Conversation,
  ConversationDetail,
  DailySummary,
  MobileSession,
  Overview,
  Todo,
} from "./src/api/types";
import {
  clearStoredSession,
  isSecureStorageAvailable,
  loadStoredSession,
  saveStoredSession,
  type StoredSession,
} from "./src/auth/storage";
import type { CompanionSnapshot } from "./src/state/companionMachine";
import { canRetry } from "./src/state/companionMachine";
import { useVoiceSession, type VoiceSession } from "./src/state/useVoiceSession";
import { useWakeWord } from "./src/wake/useWakeWord";

type Tab = "home" | "conversations" | "tasks" | "summaries" | "settings";

const COLORS = {
  bg: "#08141f",
  panel: "#0f2434",
  panel2: "#143247",
  border: "#21475f",
  text: "#f3f8fb",
  muted: "#9db4c3",
  accent: "#50d6b3",
  accentDark: "#0e5d50",
  danger: "#ff8b8b",
  warn: "#ffd479",
  listening: "#ff6b7a",
};

const STATE_LABEL: Record<CompanionSnapshot["state"], string> = {
  disconnected: "Offline",
  connected: "Connected",
  idle: "Ready",
  wake_word_detected: "Wake word heard",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  error: "Needs attention",
};

function stateColor(state: CompanionSnapshot["state"]): string {
  if (state === "listening" || state === "wake_word_detected") return COLORS.listening;
  if (state === "processing" || state === "speaking") return COLORS.warn;
  if (state === "error" || state === "disconnected") return COLORS.danger;
  return COLORS.accent;
}

function fmt(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function short(value: string | null | undefined, limit = 220): string {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

export default function App() {
  const [stored, setStored] = useState<StoredSession | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadStoredSession().then((value) => setStored(value));
  }, []);

  async function paired(session: StoredSession) {
    await saveStoredSession(session);
    setNotice("Paired. The token is stored in the phone's secure storage.");
    setStored(session);
  }

  async function unpaired(reason?: string) {
    await clearStoredSession();
    setStored(null);
    setNotice(reason ?? "This phone is no longer paired.");
  }

  if (stored === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.mutedText}>Opening secure storage…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (stored === null) {
    return <PairingScreen notice={notice} onPaired={paired} />;
  }

  return (
    <CompanionApp
      key={`${stored.baseUrl}|${stored.token}`}
      stored={stored}
      onUnpaired={unpaired}
    />
  );
}

function PairingScreen(props: {
  notice: string | null;
  onPaired: (session: StoredSession) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(
    Platform.OS === "ios" ? "iPhone" : "Android phone",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secureAvailable, setSecureAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void isSecureStorageAvailable().then(setSecureAvailable);
  }, []);

  async function pair() {
    setError(null);
    if (secureAvailable !== true) {
      setError("Secure storage is unavailable. The app will not keep a token in plain storage.");
      return;
    }
    let normalized: string;
    try {
      normalized = normalizeBaseUrl(baseUrl);
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    if (!username.trim() || !password) {
      setError("Enter the Voice+ operator username and password.");
      return;
    }
    if (isInsecureBaseUrl(normalized)) {
      setError(
        "Use HTTPS for a server outside your local network. Pairing sends the operator password.",
      );
      return;
    }

    setBusy(true);
    try {
      const client = createApiClient({ baseUrl: normalized, token: "" });
      const response = await client.pair({
        username: username.trim(),
        password,
        deviceName: deviceName.trim() || "Mobile device",
      });
      await props.onPaired({
        baseUrl: normalized,
        token: response.token,
        deviceName: response.device.device_name,
        username: response.user.username,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const insecure = baseUrl.trim() ? isInsecureBaseUrl(baseUrl.trim()) : false;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.pairing} keyboardShouldPersistTaps="handled">
          <Text style={styles.kicker}>BEE VOICE+</Text>
          <Text style={styles.title}>Pair this phone</Text>
          <Text style={styles.body}>
            The phone talks only to your Voice+ server. It never receives the Bee token,
            AI key, or raw Bee database.
          </Text>

          {props.notice ? <Notice tone="info" text={props.notice} /> : null}
          {error ? <Notice tone="error" text={error} /> : null}
          {insecure ? (
            <Notice
              tone="warn"
              text="This is an HTTP address outside your local network. Use HTTPS in production."
            />
          ) : null}
          {secureAvailable === false ? (
            <Notice
              tone="error"
              text="The OS secure store is unavailable, so pairing is disabled rather than storing a token insecurely."
            />
          ) : null}

          <Field label="Server address" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://voice.example.com" autoCapitalize="none" keyboardType="url" />
          <Field label="Operator username" value={username} onChangeText={setUsername} placeholder="operator" autoCapitalize="none" />
          <Field label="Operator password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
          <Field label="Device name" value={deviceName} onChangeText={setDeviceName} placeholder="My phone" />

          <Pressable
            style={[styles.primaryButton, (busy || secureAvailable !== true) && styles.disabled]}
            onPress={() => void pair()}
            disabled={busy || secureAvailable !== true}
          >
            {busy ? <ActivityIndicator color="#05251e" /> : <Text style={styles.primaryButtonText}>Pair securely</Text>}
          </Pressable>

          <Text style={styles.smallMuted}>
            The server must be running and reachable from this phone. On an Android emulator,
            use http://10.0.2.2:5000. A physical phone needs the computer's LAN address or a
            deployed HTTPS URL.
          </Text>
          <Text style={styles.smallMuted}>
            Permissions used later: microphone for push-to-talk, and optionally speech
            recognition for an on-device wake word. No contacts, location, Bluetooth, or
            background location access is requested.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CompanionApp(props: { stored: StoredSession; onUnpaired: (reason?: string) => Promise<void> }) {
  const [expired, setExpired] = useState(false);
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [wakeNotice, setWakeNotice] = useState<string | null>(null);

  const onUnauthorized = useCallback(() => setExpired(true), []);
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: props.stored.baseUrl,
        token: props.stored.token,
        onUnauthorized,
      }),
    [props.stored.baseUrl, props.stored.token, onUnauthorized],
  );

  const voice = useVoiceSession(api);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setSessionError(null);
    try {
      const value = await api.session();
      setSession(value);
      voice.markConnected();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setExpired(true);
        return;
      }
      const message = errorMessage(caught);
      setSessionError(message);
      voice.markDisconnected(message);
    } finally {
      setLoading(false);
    }
  }, [api, voice]);

  useEffect(() => {
    void loadSession();
    // The session is intentionally checked once per app mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    if (expired) {
      void props.onUnpaired("The server rejected this pairing. Pair the phone again.");
    }
    // Only react to the transition; the callback is provided by the app shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void voice.cancel();
    });
    return () => subscription.remove();
  }, [voice.cancel]);

  const wake = useWakeWord({
    enabled: wakeEnabled && Boolean(session),
    phrase: session?.capabilities.wake_word.phrase || "Hey Bee",
    language: "en-US",
    active:
      Boolean(session) &&
      tab === "home" &&
      !loading &&
      !sessionError &&
      (voice.snapshot.state === "idle" || voice.snapshot.state === "connected"),
    onDetected: () => {
      void voice.wakeWordDetected();
    },
    onUnavailable: (reason) => {
      setWakeEnabled(false);
      setWakeNotice(reason);
    },
  });

  if (loading && !session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.mutedText}>Checking the Voice+ connection…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Cannot reach Voice+</Text>
          <Text style={[styles.body, styles.centerText]}>{sessionError}</Text>
          <Pressable style={styles.primaryButton} onPress={() => void loadSession()}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => void props.onUnpaired()}>
            <Text style={styles.textButtonText}>Unpair this phone</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.shell}>
        <View style={styles.topBar}>
          <View style={styles.flex}>
            <Text style={styles.kicker}>BEE VOICE+</Text>
            <Text style={styles.topTitle}>{session.user.display_name || session.user.username}</Text>
            <Text style={styles.smallMuted} numberOfLines={1}>
              {props.stored.baseUrl.replace(/^https?:\/\//, "")} · {props.stored.deviceName}
            </Text>
          </View>
          <View style={[styles.statusPill, { borderColor: stateColor(voice.snapshot.state) }]}>
            <View style={[styles.dot, { backgroundColor: stateColor(voice.snapshot.state) }]} />
            <Text style={styles.statusText}>{STATE_LABEL[voice.snapshot.state]}</Text>
          </View>
        </View>

        {sessionError ? (
          <Notice tone="error" text={sessionError} />
        ) : null}

        <View style={styles.flex}>
          {tab === "home" ? (
            <HomeScreen
              api={api}
              session={session}
              voice={voice}
              wakeEnabled={wakeEnabled}
              wakeAvailability={wake.availability}
              wakeChecking={wake.checking}
              onOpenSettings={() => setTab("settings")}
            />
          ) : null}
          {tab === "conversations" ? <ConversationsScreen api={api} /> : null}
          {tab === "tasks" ? <TasksScreen api={api} /> : null}
          {tab === "summaries" ? <SummariesScreen api={api} /> : null}
          {tab === "settings" ? (
            <SettingsScreen
              api={api}
              session={session}
              voice={voice}
              wakeEnabled={wakeEnabled}
              wakeChecking={wake.checking}
              wakeAvailability={wake.availability}
              wakeNotice={wakeNotice}
              onWakeChange={(enabled) => {
                setWakeNotice(null);
                setWakeEnabled(enabled);
              }}
              onUnpaired={props.onUnpaired}
            />
          ) : null}
        </View>

        <View style={styles.tabBar}>
          {(
            [
              ["home", "Talk"],
              ["conversations", "Conversations"],
              ["tasks", "Tasks"],
              ["summaries", "Summaries"],
              ["settings", "Settings"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabActive]}
              onPress={() => setTab(key)}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

function HomeScreen(props: {
  api: ApiClient;
  session: MobileSession;
  voice: VoiceSession;
  wakeEnabled: boolean;
  wakeAvailability: { available: boolean; reason: string } | null;
  wakeChecking: boolean;
  onOpenSettings: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(true);
  const snapshot = props.voice.snapshot;
  const canTalk =
    props.session.capabilities.assistant_chat &&
    props.session.capabilities.assistant_transcribe;

  const load = useCallback(async () => {
    try {
      setOverview(await props.api.overview());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [props.api]);

  useEffect(() => {
    if (appActive) void load();
    const poll = setInterval(() => {
      if (appActive) void load();
    }, 60_000);
    return () => clearInterval(poll);
  }, [load, appActive]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  async function syncNow() {
    setSyncing(true);
    setSyncNotice(null);
    setSyncError(null);
    try {
      const run = await props.api.sync(false);
      setSyncNotice(
        run.status === "ok" || run.status === "success"
          ? "Bee sync completed."
          : `Bee sync finished with status: ${run.status}.`,
      );
      await load();
    } catch (caught) {
      setSyncError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  const canRequest =
    snapshot.state !== "processing" &&
    snapshot.state !== "listening" &&
    snapshot.state !== "speaking";

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {!canTalk ? (
        <Notice
          tone="warn"
          text="The AI provider is not configured on the server, so voice questions cannot be answered yet. Conversation, task, and summary sync still work."
        />
      ) : null}
      {error ? <Notice tone="error" text={error} /> : null}
      {syncError ? <Notice tone="error" text={`Sync failed: ${syncError}`} /> : null}
      {syncNotice ? <Notice tone="info" text={syncNotice} /> : null}

      <View style={styles.talkPanel}>
        <View style={styles.talkHeader}>
          <Text style={styles.panelTitle}>Voice question</Text>
          <Pressable onPress={() => props.voice.setMuted(!snapshot.muted)}>
            <Text style={styles.mutedToggle}>
              {snapshot.muted ? "Muted · tap to unmute" : "Speak answers · tap to mute"}
            </Text>
          </Pressable>
        </View>

        {props.wakeEnabled ? (
          <Text style={styles.wakeLine}>
            {props.wakeChecking
              ? "Preparing on-device wake word…"
              : props.wakeAvailability?.available
                ? `Listening locally for “${props.session.capabilities.wake_word.phrase || "Hey Bee"}” while this screen is ready.`
                : "Wake word is unavailable. Push-to-talk still works."}
          </Text>
        ) : (
          <Pressable onPress={props.onOpenSettings}>
            <Text style={styles.wakeLine}>
              Push-to-talk is always available. Enable optional on-device wake word in Settings.
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            snapshot.state === "listening"
              ? "Recording. Release to send."
              : "Hold to ask a question"
          }
          accessibilityHint="Records one short question and sends it to your Voice+ server."
          accessibilityState={{
            disabled: !canTalk || !canRequest,
            busy: snapshot.state === "processing",
            selected: snapshot.state === "listening",
          }}
          onPressIn={() => {
            if (canTalk && (snapshot.state === "idle" || snapshot.state === "connected" || snapshot.state === "error")) {
              void props.voice.startListening();
            }
          }}
          onPressOut={() => {
            void props.voice.stopListening();
          }}
          disabled={!canTalk || !canRequest}
          style={[
            styles.micButton,
            (snapshot.state === "listening" || snapshot.state === "wake_word_detected") &&
              styles.micButtonLive,
            (!canTalk || !canRequest) && styles.disabled,
          ]}
        >
          {snapshot.state === "processing" ? (
            <ActivityIndicator color={COLORS.text} />
          ) : (
            <Text style={styles.micIcon}>{snapshot.state === "listening" ? "■" : "●"}</Text>
          )}
          <Text style={styles.micLabel}>
            {snapshot.state === "listening"
              ? "Release to send"
              : snapshot.state === "processing"
                ? "Transcribing and thinking…"
                : snapshot.state === "speaking"
                  ? "Speaking"
                  : canTalk
                    ? "Hold to ask"
                    : "AI not configured"}
          </Text>
        </Pressable>

        <Text style={styles.hint}>
          Hold the button, ask one question, then release. Audio is sent once to your server,
          not stored by this app. Maximum 15 seconds.
        </Text>

        {snapshot.state === "listening" || snapshot.state === "processing" || snapshot.state === "speaking" ? (
          <Pressable style={styles.secondaryButton} onPress={() => void props.voice.cancel()}>
            <Text style={styles.secondaryButtonText}>
              {snapshot.state === "speaking" ? "Stop speaking" : "Cancel"}
            </Text>
          </Pressable>
        ) : null}

        {snapshot.error ? <Notice tone="error" text={snapshot.error} /> : null}
        {canRetry(snapshot) ? (
          <Pressable style={styles.secondaryButton} onPress={() => void props.voice.retry()}>
            <Text style={styles.secondaryButtonText}>Retry last question</Text>
          </Pressable>
        ) : null}

        {snapshot.question ? (
          <View style={styles.answerBlock}>
            <Text style={styles.label}>You asked</Text>
            <Text style={styles.question}>{snapshot.question}</Text>
          </View>
        ) : null}

        {snapshot.answer ? (
          <View style={styles.answerBlock}>
            <Text style={styles.label}>Answer</Text>
            <Text style={styles.answer}>{snapshot.answer}</Text>
            {snapshot.sources.length ? (
              <>
                <Text style={styles.label}>Sources used</Text>
                {snapshot.sources.map((source) => (
                  <View key={`${source.kind}-${source.id}-${source.ref}`} style={styles.source}>
                    <Text style={styles.sourceTitle}>
                      {source.kind} · {source.title}
                    </Text>
                    <Text style={styles.sourceSnippet}>{short(source.snippet, 180)}</Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.smallMuted}>No matching owner-scoped records were cited.</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.statsRow}>
        <Stat value={overview?.counts.conversations ?? 0} label="Conversations" />
        <Stat value={overview?.counts.todos ?? overview?.counts.tasks ?? 0} label="Tasks" />
        <Stat value={overview?.counts.summaries ?? 0} label="Summaries" />
      </View>

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <Text style={styles.panelTitle}>Sync</Text>
          <Pressable
            style={[styles.smallButton, (syncing || !props.session.capabilities.bee_sync) && styles.disabled]}
            onPress={() => void syncNow()}
            disabled={syncing || !props.session.capabilities.bee_sync}
          >
            {syncing ? (
              <ActivityIndicator color={COLORS.accent} size="small" />
            ) : (
              <Text style={styles.smallButtonText}>Sync now</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.smallMuted}>
          {props.session.capabilities.bee_sync
            ? "Uses the Bee data interface configured on the server. The phone never talks to Bee directly."
            : "Bee is not configured on the server, so only local data is available."}
        </Text>
        {overview?.sync?.last_synced_at ? (
          <Text style={styles.smallMuted}>Last sync: {fmt(overview.sync.last_synced_at)}</Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Recent conversations</Text>
        {loading ? <ActivityIndicator color={COLORS.accent} /> : null}
        {(overview?.recent_conversations ?? []).slice(0, 4).map((conversation) => (
          <View key={`${conversation.bee_id}`} style={styles.listItem}>
            <Text style={styles.listTitle}>{short(conversation.short_summary || conversation.summary, 110)}</Text>
            <Text style={styles.listMeta}>{fmt(conversation.start_time || conversation.synced_at)}</Text>
          </View>
        ))}
        {!loading && !overview?.recent_conversations?.length ? (
          <Text style={styles.smallMuted}>No conversations synced yet.</Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Open tasks</Text>
        {(overview?.open_todos ?? []).slice(0, 4).map((todo) => (
          <View key={`${todo.bee_id}`} style={styles.listItem}>
            <Text style={styles.listTitle}>{todo.text}</Text>
            <Text style={styles.listMeta}>
              {todo.origin} · {todo.due_at ? fmt(todo.due_at) : "no due date"}
            </Text>
          </View>
        ))}
        {!overview?.open_todos?.length ? (
          <Text style={styles.smallMuted}>No open tasks.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ConversationsScreen(props: { api: ApiClient }) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await props.api.conversations()).items);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [props.api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(conversation: Conversation) {
    setDetailError(null);
    try {
      setDetail(await props.api.conversation(conversation.bee_id));
    } catch (caught) {
      setDetailError(errorMessage(caught));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.rowBetween}>
        <Text style={styles.screenTitle}>Conversations</Text>
        <Pressable style={styles.smallButton} onPress={() => void load()}>
          <Text style={styles.smallButtonText}>Refresh</Text>
        </Pressable>
      </View>
      {error ? <Notice tone="error" text={error} /> : null}
      {detailError ? <Notice tone="error" text={detailError} /> : null}
      {loading ? <ActivityIndicator color={COLORS.accent} /> : null}
      {detail ? (
        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.panelTitle}>Conversation {detail.bee_id}</Text>
            <Pressable onPress={() => setDetail(null)}>
              <Text style={styles.linkText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.smallMuted}>{fmt(detail.start_time || detail.synced_at)}</Text>
          <Text style={styles.answer}>{detail.summary || detail.short_summary || "No summary."}</Text>
          {detail.transcriptions?.map((transcription, index) =>
            (transcription.utterances ?? []).map((utterance, utteranceIndex) => (
              <Text key={`${index}-${utteranceIndex}`} style={styles.transcript}>
                <Text style={styles.transcriptSpeaker}>{utterance.speaker ?? "speaker"}: </Text>
                {utterance.text}
              </Text>
            )),
          )}
        </View>
      ) : null}
      {items.map((conversation) => (
        <Pressable
          key={conversation.bee_id}
          style={styles.panel}
          onPress={() => void open(conversation)}
        >
          <Text style={styles.listTitle}>
            {short(conversation.short_summary || conversation.summary, 160) || "Untitled conversation"}
          </Text>
          <Text style={styles.listMeta}>
            {fmt(conversation.start_time || conversation.synced_at)} · Bee #{conversation.bee_id}
          </Text>
        </Pressable>
      ))}
      {!loading && !items.length ? (
        <Text style={styles.smallMuted}>No conversations synced yet.</Text>
      ) : null}
    </ScrollView>
  );
}

function TasksScreen(props: { api: ApiClient }) {
  const [status, setStatus] = useState<"open" | "completed" | "all">("open");
  const [items, setItems] = useState<Todo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await props.api.tasks(status)).items);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [props.api, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(todo: Todo) {
    setBusyId(todo.bee_id);
    setError(null);
    try {
      await props.api.updateTask(todo.bee_id, !todo.completed);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.rowBetween}>
        <Text style={styles.screenTitle}>Tasks</Text>
        <Pressable style={styles.smallButton} onPress={() => void load()}>
          <Text style={styles.smallButtonText}>Refresh</Text>
        </Pressable>
      </View>
      <View style={styles.segmented}>
        {(["open", "completed", "all"] as const).map((value) => (
          <Pressable
            key={value}
            style={[styles.segment, status === value && styles.segmentActive]}
            onPress={() => setStatus(value)}
          >
            <Text style={[styles.segmentText, status === value && styles.segmentTextActive]}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Notice tone="error" text={error} /> : null}
      {items.map((todo) => (
        <View key={todo.bee_id} style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={[styles.listTitle, todo.completed && styles.done]}>{todo.text}</Text>
            <Switch
              value={todo.completed}
              disabled={busyId === todo.bee_id}
              onValueChange={() => void toggle(todo)}
              trackColor={{ false: COLORS.border, true: COLORS.accentDark }}
              thumbColor={todo.completed ? COLORS.accent : COLORS.muted}
            />
          </View>
          <Text style={styles.listMeta}>
            {todo.origin}
            {todo.ai_generated ? " · AI-extracted" : ""} ·{" "}
            {todo.due_at ? fmt(todo.due_at) : "no due date"}
          </Text>
        </View>
      ))}
      {!items.length ? <Text style={styles.smallMuted}>No tasks in this view.</Text> : null}
    </ScrollView>
  );
}

function SummariesScreen(props: { api: ApiClient }) {
  const [items, setItems] = useState<DailySummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await props.api.summaries()).items);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [props.api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.rowBetween}>
        <Text style={styles.screenTitle}>Daily summaries</Text>
        <Pressable style={styles.smallButton} onPress={() => void load()}>
          <Text style={styles.smallButtonText}>Refresh</Text>
        </Pressable>
      </View>
      {error ? <Notice tone="error" text={error} /> : null}
      {items.map((summary) => (
        <View key={summary.bee_id} style={styles.panel}>
          <Text style={styles.listTitle}>
            {summary.day || fmt(summary.day_time || summary.synced_at)}
          </Text>
          <Text style={styles.answer}>
            {summary.summary || summary.short_summary || "No summary text."}
          </Text>
          <Text style={styles.listMeta}>
            {summary.conversations_count != null
              ? `${summary.conversations_count} conversations`
              : "Daily summary"}
          </Text>
        </View>
      ))}
      {!items.length ? <Text style={styles.smallMuted}>No summaries synced yet.</Text> : null}
    </ScrollView>
  );
}

function SettingsScreen(props: {
  api: ApiClient;
  session: MobileSession;
  voice: VoiceSession;
  wakeEnabled: boolean;
  wakeChecking: boolean;
  wakeAvailability: { available: boolean; reason: string } | null;
  wakeNotice: string | null;
  onWakeChange: (enabled: boolean) => void;
  onUnpaired: (reason?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"delete" | "unpair" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteData() {
    Alert.alert(
      "Delete local Voice+ data?",
      "This deletes the server's local copy of Bee conversations, tasks, summaries, meetings, and learning data for this operator. Bee itself is not modified. You can sync again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setBusy("delete");
            setError(null);
            void props.api
              .deleteData()
              .then((result) => setNotice(result.message))
              .catch((caught) => setError(errorMessage(caught)))
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  }

  async function unpair() {
    setBusy("unpair");
    setError(null);
    try {
      await props.api.logout();
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.status === 401)) {
        setError(errorMessage(caught));
        setBusy(null);
        return;
      }
    }
    await props.onUnpaired("This phone was unpaired and its token was revoked.");
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.screenTitle}>Settings</Text>
      {notice ? <Notice tone="info" text={notice} /> : null}
      {error ? <Notice tone="error" text={error} /> : null}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Connection</Text>
        <Text style={styles.smallMuted}>Server: {props.api.baseUrl}</Text>
        <Text style={styles.smallMuted}>Operator: {props.session.user.username}</Text>
        <Text style={styles.smallMuted}>Device: {props.session.device.device_name}</Text>
        <Text style={styles.smallMuted}>Token expires: {fmt(props.session.device.expires_at)}</Text>
        <Text style={styles.smallMuted}>
          Audio output: the phone's current OS route. Bluetooth earbuds and speakers use the
          operating system's normal routing; this app cannot access Bee's speaker or Bluetooth.
        </Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.panelTitle}>On-device wake word</Text>
            <Text style={styles.smallMuted}>
              Optional. Requires operating-system speech recognition that explicitly supports
              on-device processing. Wake audio is never sent to Voice+.
            </Text>
          </View>
          <Switch
            value={props.wakeEnabled}
            disabled={props.wakeChecking || !props.session.capabilities.assistant_chat}
            onValueChange={props.onWakeChange}
            trackColor={{ false: COLORS.border, true: COLORS.accentDark }}
            thumbColor={props.wakeEnabled ? COLORS.accent : COLORS.muted}
          />
        </View>
        {props.wakeNotice ? <Notice tone="warn" text={props.wakeNotice} /> : null}
        {props.wakeAvailability ? (
          <Text style={styles.smallMuted}>{props.wakeAvailability.reason}</Text>
        ) : (
          <Text style={styles.smallMuted}>
            Toggle on to check whether this phone and OS can run a local detector.
          </Text>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Microphone and speaking</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.body}>Mute spoken answers</Text>
          <Switch
            value={props.voice.snapshot.muted}
            onValueChange={props.voice.setMuted}
            trackColor={{ false: COLORS.border, true: COLORS.accentDark }}
            thumbColor={props.voice.snapshot.muted ? COLORS.accent : COLORS.muted}
          />
        </View>
        <Text style={styles.smallMuted}>
          The microphone is active only while you hold the talk button, or while the optional
          on-device wake detector is enabled and the app is in the foreground. A red state on
          the Talk screen shows listening.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Data controls</Text>
        <Pressable
          style={[styles.secondaryButton, busy && styles.disabled]}
          onPress={() => void deleteData()}
          disabled={Boolean(busy)}
        >
          {busy === "delete" ? (
            <ActivityIndicator color={COLORS.text} />
          ) : (
            <Text style={styles.secondaryButtonText}>Delete local server data…</Text>
          )}
        </Pressable>
        <Text style={styles.smallMuted}>
          Deletion only affects this app's local mirror. It never deletes or modifies Bee data.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>This phone</Text>
        <Pressable
          style={[styles.dangerButton, busy && styles.disabled]}
          onPress={() => void unpair()}
          disabled={Boolean(busy)}
        >
          {busy === "unpair" ? (
            <ActivityIndicator color="#2a0a0a" />
          ) : (
            <Text style={styles.dangerButtonText}>Unpair and revoke token</Text>
          )}
        </Pressable>
        <Text style={styles.smallMuted}>
          Unpairing deletes the token from the phone's secure storage and revokes it on the
          server. The website session is not affected.
        </Text>
      </View>

      <Text style={styles.smallMuted}>
        Build 0.1.0 · Phase 3 companion. No Bee firmware, microphone, speaker, Bluetooth, or
        wake-word interface is used because Bee does not publish one.
      </Text>
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "url";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={COLORS.muted}
        secureTextEntry={props.secureTextEntry}
        autoCapitalize={props.autoCapitalize}
        autoCorrect={false}
        keyboardType={props.keyboardType}
      />
    </View>
  );
}

function Notice(props: { tone: "info" | "warn" | "error"; text: string | null }) {
  if (!props.text) return null;
  const color =
    props.tone === "error" ? COLORS.danger : props.tone === "warn" ? COLORS.warn : COLORS.accent;
  return (
    <View style={[styles.notice, { borderColor: color }]}>
      <Text style={[styles.noticeText, { color }]}>{props.text}</Text>
    </View>
  );
}

function Stat(props: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{props.value}</Text>
      <Text style={styles.statLabel}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === "android" ? 24 : 0,
  },
  flex: { flex: 1 },
  shell: { flex: 1, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  centerText: { textAlign: "center" },
  pairing: { padding: 24, gap: 12, paddingBottom: 48 },
  kicker: { color: COLORS.accent, fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  title: { color: COLORS.text, fontSize: 30, fontWeight: "800", marginTop: 4 },
  body: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  mutedText: { color: COLORS.muted, fontSize: 14 },
  smallMuted: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  topBar: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  topTitle: { color: COLORS.text, fontSize: 20, fontWeight: "800" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.panel,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: COLORS.text, fontSize: 11, fontWeight: "700" },
  scroll: { gap: 12, paddingBottom: 28 },
  talkPanel: { backgroundColor: COLORS.panel, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  talkHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  panelTitle: { color: COLORS.text, fontSize: 17, fontWeight: "800" },
  mutedToggle: { color: COLORS.accent, fontSize: 12, fontWeight: "700" },
  wakeLine: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  micButton: {
    alignSelf: "center",
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: COLORS.accentDark,
    borderWidth: 2,
    borderColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginVertical: 8,
  },
  micButtonLive: { backgroundColor: "#5c1722", borderColor: COLORS.listening },
  micIcon: { color: COLORS.text, fontSize: 46, lineHeight: 50 },
  micLabel: { color: COLORS.text, fontSize: 14, fontWeight: "800", textAlign: "center", paddingHorizontal: 16 },
  hint: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  answerBlock: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12, gap: 6 },
  label: { color: COLORS.accent, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  question: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  answer: { color: COLORS.text, fontSize: 15, lineHeight: 23 },
  source: { backgroundColor: COLORS.panel2, padding: 10, borderRadius: 10, gap: 3 },
  sourceTitle: { color: COLORS.text, fontSize: 12, fontWeight: "700" },
  sourceSnippet: { color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: COLORS.panel, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  statValue: { color: COLORS.text, fontSize: 24, fontWeight: "800" },
  statLabel: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  panel: { backgroundColor: COLORS.panel, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  smallButton: { backgroundColor: COLORS.accentDark, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: COLORS.accent, fontSize: 12, fontWeight: "800" },
  listItem: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8, gap: 3 },
  listTitle: { color: COLORS.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  listMeta: { color: COLORS.muted, fontSize: 11 },
  screenTitle: { color: COLORS.text, fontSize: 24, fontWeight: "800", marginTop: 6 },
  transcript: { color: COLORS.text, fontSize: 13, lineHeight: 19 },
  transcriptSpeaker: { color: COLORS.accent, fontWeight: "700" },
  segmented: { flexDirection: "row", backgroundColor: COLORS.panel, borderRadius: 10, padding: 4, borderWidth: 1, borderColor: COLORS.border },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: "center" },
  segmentActive: { backgroundColor: COLORS.accentDark },
  segmentText: { color: COLORS.muted, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  segmentTextActive: { color: COLORS.accent },
  done: { textDecorationLine: "line-through", color: COLORS.muted },
  primaryButton: { backgroundColor: COLORS.accent, borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  primaryButtonText: { color: "#05251e", fontSize: 16, fontWeight: "900" },
  secondaryButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingVertical: 11, alignItems: "center", backgroundColor: COLORS.panel2 },
  secondaryButtonText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  dangerButton: { backgroundColor: COLORS.danger, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  dangerButtonText: { color: "#2a0a0a", fontSize: 13, fontWeight: "900" },
  textButton: { paddingVertical: 10 },
  textButtonText: { color: COLORS.muted, fontSize: 13, textDecorationLine: "underline" },
  disabled: { opacity: 0.45 },
  field: { gap: 6 },
  input: { backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, color: COLORS.text, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: COLORS.panel },
  noticeText: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  linkText: { color: COLORS.accent, fontSize: 12, fontWeight: "700" },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6, paddingBottom: 4, gap: 2 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  tabActive: { backgroundColor: COLORS.panel2 },
  tabText: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  tabTextActive: { color: COLORS.accent },
});
