import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "bee_voice_plus.mobile_session.v1";

export interface StoredSession {
  baseUrl: string;
  token: string;
  deviceName: string;
  username?: string;
}

export async function isSecureStorageAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    const value = await SecureStore.getItemAsync(SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.deviceName !== "string" ||
      !parsed.baseUrl ||
      !parsed.token
    ) {
      await clearStoredSession();
      return null;
    }
    return {
      baseUrl: parsed.baseUrl,
      token: parsed.token,
      deviceName: parsed.deviceName,
      username: typeof parsed.username === "string" ? parsed.username : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Already absent or secure storage unavailable.
  }
}
