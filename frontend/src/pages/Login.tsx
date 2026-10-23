import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useAuth } from "../store";
import type { DemoLogin } from "../types";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoLogin | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<DemoLogin>("/api/auth/demo")
      .then((value) => {
        if (active) setDemo(value);
      })
      .catch(() => {
        if (active) setDemo({ enabled: false });
      });
    return () => {
      active = false;
    };
  }, []);

  function fillDemoAccount() {
    if (!demo?.username || !demo.password) return;
    setUsername(demo.username);
    setPassword(demo.password);
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <div>
            <strong>Bee Voice+</strong>
            <span className="muted small">Your Bee context, in one place</span>
          </div>
        </div>

        <h1>Sign in</h1>
        <p className="muted">
          This dashboard has its own operator account. Your Bee credentials stay
          on the server.
        </p>

        <form onSubmit={onSubmit} className="form">
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              disabled={busy}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="button primary wide"
            disabled={busy || !username || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {demo?.enabled && demo.username && demo.password ? (
          <div className="demo-login">
            <div className="demo-login-head">
              <strong>Demo account</strong>
              <span className="muted small">development only</span>
            </div>
            <p className="muted small">
              Sign in with these credentials to explore the dashboard.
            </p>
            <dl className="demo-credentials">
              <div>
                <dt>Username</dt>
                <dd>
                  <code>{demo.username}</code>
                </dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>
                  <code>{demo.password}</code>
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="button secondary wide"
              onClick={fillDemoAccount}
              disabled={busy}
            >
              Use demo account
            </button>
          </div>
        ) : null}

        <p className="muted small auth-foot">
          Create the operator account with <code>python app.py hash-password</code> and set{" "}
          <code>APP_PASSWORD_HASH</code> on the server.
        </p>
      </div>
    </div>
  );
}
