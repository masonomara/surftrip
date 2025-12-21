/**
 * Auth Demo Page
 *
 * Demonstrates authentication flows: SSO (Google/Apple), email sign-up, and sign-in.
 */

import { renderPage } from "./shared";

// =============================================================================
// Styles
// =============================================================================

const AUTH_CSS = `
  .status-auth {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .status-unauth {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .user-details {
    background: #f5f5f5;
    border-radius: 8px;
    padding: 16px;
    font-family: monospace;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-all;
    margin-top: 16px;
  }

  .btn-google {
    background: #fff;
    color: #333;
  }

  .btn-apple {
    background: #000;
    color: #fff;
  }

  .btn-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .divider {
    display: flex;
    align-items: center;
    margin: 20px 0;
    color: #64748b;
  }

  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid #334155;
  }

  .divider span {
    padding: 0 16px;
    font-size: 12px;
    text-transform: uppercase;
  }

  .error,
  .success {
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 16px;
    display: none;
  }

  .error {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .success {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }
`;

// =============================================================================
// Scripts
// =============================================================================

const AUTH_SCRIPT = `
  async function socialSignIn(provider) {
    const response = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, callbackURL: location.href })
    });
    const data = await response.json();
    if (data.url) {
      location.href = data.url;
    }
  }

  async function signUp(event) {
    event.preventDefault();
    const errorEl = document.getElementById('signup-error');
    const successEl = document.getElementById('signup-success');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const response = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });

    const data = await response.json();
    if (data.user) {
      successEl.textContent = 'Account created!';
      successEl.style.display = 'block';
      setTimeout(() => location.reload(), 1000);
    } else {
      errorEl.textContent = data.error?.message || data.message || 'Failed';
      errorEl.style.display = 'block';
    }
  }

  async function signIn(event) {
    event.preventDefault();
    const errorEl = document.getElementById('signin-error');
    errorEl.style.display = 'none';

    const response = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('signin-email').value,
        password: document.getElementById('signin-password').value
      })
    });

    const data = await response.json();
    if (data.user) {
      location.reload();
    } else {
      errorEl.textContent = data.error?.message || data.message || 'Invalid';
      errorEl.style.display = 'block';
    }
  }

  async function signOut() {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include'
    });
    location.reload();
  }
`;

// =============================================================================
// Templates
// =============================================================================

interface Session {
  user: { email: string; [key: string]: unknown };
  session: { id: string; expiresAt: Date | string };
}

function buildLoggedInContent(session: Session): string {
  const userJson = JSON.stringify(session.user, null, 2);
  const sessionJson = JSON.stringify(
    { id: session.session.id, expiresAt: session.session.expiresAt },
    null,
    2
  );

  return `
    <div class="card">
      <h2>User</h2>
      <div class="user-details">${userJson}</div>
      <div style="margin-top: 16px">
        <button class="btn btn-danger" onclick="signOut()">Sign Out</button>
      </div>
    </div>

    <div class="card">
      <h2>Session</h2>
      <div class="user-details">${sessionJson}</div>
    </div>
  `;
}

function buildLoggedOutContent(): string {
  return `
    <div class="card">
      <h2>SSO</h2>
      <div class="btn-row">
        <button class="btn btn-google" onclick="socialSignIn('google')">Google</button>
        <button class="btn btn-apple" onclick="socialSignIn('apple')">Apple</button>
      </div>
    </div>

    <div class="divider"><span>or</span></div>

    <div class="card">
      <h2>Sign Up</h2>
      <div id="signup-error" class="error"></div>
      <div id="signup-success" class="success"></div>
      <form onsubmit="signUp(event)">
        <div class="form-group">
          <label>Name</label>
          <input id="name" class="input" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="email" class="input" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="password" class="input" required minlength="8">
        </div>
        <button type="submit" class="btn btn-primary">Create</button>
      </form>
    </div>

    <div class="card">
      <h2>Sign In</h2>
      <div id="signin-error" class="error"></div>
      <form onsubmit="signIn(event)">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="signin-email" class="input" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="signin-password" class="input" required>
        </div>
        <button type="submit" class="btn btn-secondary">Sign In</button>
      </form>
    </div>
  `;
}

// =============================================================================
// Page Builder
// =============================================================================

export function buildAuthPage(session: Session | null): string {
  const isLoggedIn = session !== null;
  const statusClass = isLoggedIn ? "status-auth" : "status-unauth";
  const statusText = isLoggedIn
    ? `Signed in as ${session.user.email}`
    : "Not signed in";

  const statusCard = `
    <div class="card">
      <h2>Status</h2>
      <div class="status ${statusClass}">${statusText}</div>
    </div>
  `;

  const content = isLoggedIn
    ? buildLoggedInContent(session)
    : buildLoggedOutContent();

  return renderPage({
    title: "Docket",
    subtitle: "Auth Demo",
    body: statusCard + content,
    script: AUTH_SCRIPT,
    extraCSS: AUTH_CSS,
  });
}
