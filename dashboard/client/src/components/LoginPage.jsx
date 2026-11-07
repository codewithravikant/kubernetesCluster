import { useState } from "react";

export default function LoginPage({ onLogin, theme, onToggleTheme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-theme">
        <button className="btn btn-ghost" type="button" onClick={onToggleTheme}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>

      <div className="login-panel">
        <header className="login-brand">
          <p className="login-eyebrow">Cluster Chronicles</p>
          <h1>
            Infrastructure <span>Insight</span>
          </h1>
          <p className="login-lead">Sign in to the lab control plane.</p>
        </header>

        <form className="login-form" onSubmit={submit} autoComplete="on">
          <label className="login-field">
            <span>Username</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="btn btn-accent login-submit"
            type="submit"
            disabled={busy || !username || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
