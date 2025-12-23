// =============================================================================
// Clio Demo Page
// =============================================================================
//
// Renders an interactive demo page for testing the Clio OAuth integration.
// This is a developer tool, not a production UI.

export interface DemoState {
  connected: boolean;
  schemas: string[];
  userId?: string;
  tokenExpiresAt?: number;
}

/**
 * Render the Clio demo page HTML.
 */
export function renderClioDemo(state: DemoState): string {
  const { connected, schemas, userId, tokenExpiresAt } = state;

  // Calculate token expiry in minutes
  const expiresInMinutes = calculateExpiryMinutes(tokenExpiresAt);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docket + Clio Integration Demo</title>
  <style>
${CSS_STYLES}
  </style>
</head>
<body>
  <div class="container">
    ${renderHeader()}

    <div class="grid">
      ${renderConnectionCard(
        connected,
        userId,
        expiresInMinutes,
        schemas.length
      )}
      ${renderOAuthFlowCard(connected)}
      ${renderSecurityCard()}
      ${renderArchitectureCard()}
      ${connected ? renderConnectedCards(schemas) : ""}
    </div>
  </div>

  ${renderSecurityModal()}

  <script>
${CLIENT_SCRIPTS}
  </script>
</body>
</html>
`.trim();
}

// =============================================================================
// Helper Functions
// =============================================================================

function calculateExpiryMinutes(tokenExpiresAt?: number): number | null {
  if (!tokenExpiresAt) {
    return null;
  }

  const msUntilExpiry = tokenExpiresAt - Date.now();
  const minutes = Math.floor(msUntilExpiry / 1000 / 60);
  return Math.max(0, minutes);
}

// =============================================================================
// Page Sections
// =============================================================================

function renderHeader(): string {
  return `
    <header>
      <h1>Docket + Clio Integration</h1>
      <p>Secure OAuth 2.0 with PKCE - Enterprise-Grade Legal Practice Management</p>
    </header>
  `;
}

function renderConnectionCard(
  connected: boolean,
  userId: string | undefined,
  expiresInMinutes: number | null,
  schemaCount: number
): string {
  const statusBadge = connected
    ? `<span class="badge badge-success">Connected</span>`
    : `<span class="badge badge-warning">Not Connected</span>`;

  const statusClass = connected ? "status-connected" : "status-disconnected";
  const dotClass = connected ? "connected" : "disconnected";
  const statusText = connected ? "Clio Account Linked" : "Clio Not Connected";
  const statusDetail = connected
    ? `User: ${userId || "demo-user"}`
    : "Click below to start OAuth flow";

  const actionButtons = connected
    ? `
      <div class="token-info">
        <div class="token-stat">
          <div class="label">Token Expires In</div>
          <div class="value">${
            expiresInMinutes !== null ? `${expiresInMinutes}m` : "N/A"
          }</div>
        </div>
        <div class="token-stat">
          <div class="label">Schemas Cached</div>
          <div class="value">${schemaCount}</div>
        </div>
      </div>
      <div style="margin-top:1rem;display:flex;gap:0.5rem">
        <button class="btn btn-secondary" onclick="refreshToken()">Refresh Token</button>
        <button class="btn btn-danger" onclick="disconnect()">Disconnect</button>
      </div>
    `
    : `
      <a href="/clio/connect?demo=true" style="text-decoration:none">
        <button class="btn btn-primary" style="width:100%">Connect to Clio</button>
      </a>
    `;

  return `
    <div class="card">
      <div class="card-header">
        <h2>Connection Status</h2>
        ${statusBadge}
      </div>
      <div class="card-body">
        <div class="status-indicator ${statusClass}">
          <div class="status-dot ${dotClass}"></div>
          <div>
            <strong>${statusText}</strong>
            <p style="font-size:0.8rem;color:var(--gray-600)">${statusDetail}</p>
          </div>
        </div>
        ${actionButtons}
      </div>
    </div>
  `;
}

function renderOAuthFlowCard(connected: boolean): string {
  return `
    <div class="card">
      <div class="card-header">
        <h2>OAuth 2.0 + PKCE Flow</h2>
        <span class="badge badge-primary">Live</span>
      </div>
      <div class="card-body">
        <div class="flow-steps">
          ${renderFlowStep(
            1,
            "Generate PKCE",
            "Create code_verifier (43 chars) + SHA-256 challenge",
            connected
          )}
          ${renderFlowStep(
            2,
            "Sign State Parameter",
            "HMAC-SHA256 with user/org ID + timestamp",
            connected
          )}
          ${renderFlowStep(
            3,
            "Redirect to Clio",
            "User approves on Clio's consent screen",
            connected
          )}
          ${renderFlowStep(
            4,
            "Exchange Code",
            "Verify state, exchange code + verifier for tokens",
            connected
          )}
          ${renderFlowStep(
            5,
            "Encrypt & Store",
            "AES-GCM encryption with per-user derived keys",
            connected
          )}
        </div>
      </div>
    </div>
  `;
}

function renderFlowStep(
  stepNumber: number,
  title: string,
  description: string,
  isComplete: boolean
): string {
  let stepClass = "";
  if (isComplete) {
    stepClass = "complete";
  } else if (stepNumber === 1) {
    stepClass = "active";
  }

  return `
    <div class="flow-step ${stepClass}">
      <div class="step-number">${stepNumber}</div>
      <div class="step-content">
        <h4>${title}</h4>
        <p>${description}</p>
      </div>
    </div>
  `;
}

function renderSecurityCard(): string {
  return `
    <div class="card">
      <div class="card-header">
        <h2>Security Architecture</h2>
      </div>
      <div class="card-body">
        <div class="security-grid">
          ${renderSecurityItem(
            "pkce",
            "PKCE S256",
            "Prevents authorization code interception"
          )}
          ${renderSecurityItem(
            "state",
            "Signed State",
            "HMAC-SHA256 with 10-min expiry"
          )}
          ${renderSecurityItem(
            "encryption",
            "AES-GCM",
            "Authenticated encryption for tokens"
          )}
          ${renderSecurityItem(
            "isolation",
            "DO Isolation",
            "Per-org Durable Objects"
          )}
          ${renderSecurityItem(
            "refresh",
            "Auto Refresh",
            "Proactive + reactive token refresh"
          )}
          ${renderSecurityItem(
            "keys",
            "Key Derivation",
            "Per-user encryption keys"
          )}
        </div>
      </div>
    </div>
  `;
}

function renderSecurityItem(
  id: string,
  title: string,
  description: string
): string {
  const icons: Record<string, string> = {
    pkce: "&#x1F510;",
    state: "&#x270D;&#xFE0F;",
    encryption: "&#x1F512;",
    isolation: "&#x1F3E2;",
    refresh: "&#x1F504;",
    keys: "&#x1F511;",
  };

  return `
    <div class="security-item" onclick="showDetail('${id}')">
      <h4><span class="security-icon">${icons[id] || ""}</span> ${title}</h4>
      <p>${description}</p>
    </div>
  `;
}

function renderArchitectureCard(): string {
  return `
    <div class="card">
      <div class="card-header">
        <h2>System Architecture</h2>
      </div>
      <div class="card-body">
        <div class="architecture">
          <div class="arch-box arch-user">Teams/Slack<br/>User</div>
          <div class="arch-arrow">&rarr;</div>
          <div class="arch-box arch-docket">Docket<br/>Worker</div>
          <div class="arch-arrow">&rarr;</div>
          <div class="arch-box arch-docket">Tenant<br/>DO</div>
          <div class="arch-arrow">&rarr;</div>
          <div class="arch-box arch-clio">Clio<br/>API</div>
        </div>
        <div style="margin-top:1rem;padding:1rem;background:var(--gray-50);border-radius:8px;font-size:0.75rem">
          <strong>Data Flow:</strong> User message &rarr; Worker authenticates &rarr; Routes to org's Durable Object &rarr; LLM generates Clio query &rarr; Token retrieved &amp; decrypted &rarr; API call executed &rarr; Response formatted
        </div>
      </div>
    </div>
  `;
}

function renderConnectedCards(schemas: string[]): string {
  return `
    ${renderApiTesterCard()}
    ${renderSchemasCard(schemas)}
    ${renderActivityLogCard()}
  `;
}

function renderApiTesterCard(): string {
  return `
    <div class="card full-width">
      <div class="card-header">
        <h2>Interactive API Tester</h2>
      </div>
      <div class="card-body">
        <div class="api-tester">
          <div class="input-group">
            <select id="objectType">
              <option value="matter">Matters</option>
              <option value="contact">Contacts</option>
              <option value="task">Tasks</option>
              <option value="calendar_entry">Calendar Entries</option>
              <option value="time_entry">Time Entries</option>
            </select>
            <select id="operation">
              <option value="list">List All</option>
              <option value="single">Get by ID</option>
            </select>
            <input type="text" id="recordId" placeholder="Record ID (optional)" style="max-width:150px">
            <button class="btn btn-primary" onclick="testApi()">Execute</button>
          </div>
          <div id="apiOutput" class="code-block" style="display:none">
            <span class="comment">// API response will appear here</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSchemasCard(schemas: string[]): string {
  const schemaChips = schemas
    .map(
      (s) =>
        `<span style="padding:0.375rem 0.75rem;background:var(--gray-100);border-radius:6px;font-size:0.8rem;font-weight:500">${s}</span>`
    )
    .join("");

  return `
    <div class="card">
      <div class="card-header">
        <h2>Cached Clio Schemas</h2>
        <button class="btn btn-secondary" onclick="refreshSchema()" style="padding:0.375rem 0.75rem;font-size:0.75rem">Refresh</button>
      </div>
      <div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem">
          ${schemaChips}
        </div>
        <p style="margin-top:1rem;font-size:0.75rem;color:var(--gray-600)">
          Schemas are cached in SQLite within the Durable Object for fast LLM context injection.
        </p>
      </div>
    </div>
  `;
}

function renderActivityLogCard(): string {
  const timestamp = new Date().toLocaleTimeString();

  return `
    <div class="card">
      <div class="card-header">
        <h2>Activity Log</h2>
        <button class="btn btn-secondary" onclick="clearLog()" style="padding:0.375rem 0.75rem;font-size:0.75rem">Clear</button>
      </div>
      <div class="card-body">
        <div class="activity-log" id="activityLog">
          <div class="log-entry">
            <span class="log-time">${timestamp}</span>
            <span class="log-message">Demo loaded - Clio connected</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSecurityModal(): string {
  return `
    <div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="modalTitle">Security Feature</h3>
          <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" id="modalBody"></div>
      </div>
    </div>
  `;
}

// =============================================================================
// CSS Styles
// =============================================================================

const CSS_STYLES = `
:root {
  --primary: #2563eb;
  --primary-dark: #1d4ed8;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-600: #4b5563;
  --gray-800: #1f2937;
  --gray-900: #111827;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
  min-height: 100vh;
  color: var(--gray-800);
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

/* Header */
header {
  text-align: center;
  padding: 2rem 0 3rem;
  color: white;
}

header h1 {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

header p {
  opacity: 0.8;
  font-size: 1.1rem;
}

/* Badges */
.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge-success { background: var(--success); color: white; }
.badge-warning { background: var(--warning); color: white; }
.badge-primary { background: var(--primary); color: white; }

/* Grid Layout */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
}

.full-width {
  grid-column: 1 / -1;
}

/* Cards */
.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.card-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--gray-200);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-header h2 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--gray-800);
}

.card-body {
  padding: 1.5rem;
}

/* Status Indicator */
.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.status-connected {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}

.status-disconnected {
  background: #fef3c7;
  border: 1px solid #fcd34d;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.status-dot.connected { background: var(--success); }
.status-dot.disconnected { background: var(--warning); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-dark);
}

.btn-danger {
  background: white;
  color: var(--danger);
  border: 1px solid var(--danger);
}

.btn-danger:hover {
  background: #fef2f2;
}

.btn-secondary {
  background: var(--gray-100);
  color: var(--gray-800);
}

.btn-secondary:hover {
  background: var(--gray-200);
}

/* Flow Steps */
.flow-steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.flow-step {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  background: var(--gray-50);
  border: 1px solid var(--gray-200);
}

.flow-step.active {
  background: #eff6ff;
  border-color: var(--primary);
}

.flow-step.complete {
  background: #ecfdf5;
  border-color: var(--success);
}

.step-number {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--gray-300);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.flow-step.active .step-number { background: var(--primary); }
.flow-step.complete .step-number { background: var(--success); }

.step-content h4 {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.step-content p {
  font-size: 0.75rem;
  color: var(--gray-600);
}

/* Security Grid */
.security-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.security-item {
  padding: 0.75rem;
  border-radius: 8px;
  background: var(--gray-50);
  border: 1px solid var(--gray-200);
  cursor: pointer;
  transition: all 0.15s ease;
}

.security-item:hover {
  border-color: var(--primary);
  background: #eff6ff;
}

.security-item h4 {
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.security-item p {
  font-size: 0.7rem;
  color: var(--gray-600);
}

.security-icon {
  font-size: 1rem;
}

/* Architecture Diagram */
.architecture {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  gap: 0.5rem;
}

.arch-box {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 500;
}

.arch-user { background: #dbeafe; color: #1e40af; }
.arch-docket { background: #dcfce7; color: #166534; }
.arch-clio { background: #fef3c7; color: #92400e; }
.arch-arrow { color: var(--gray-400); font-size: 1.25rem; }

/* API Tester */
.api-tester {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.input-group {
  display: flex;
  gap: 0.5rem;
}

.input-group select,
.input-group input {
  flex: 1;
  padding: 0.625rem;
  border: 1px solid var(--gray-300);
  border-radius: 8px;
  font-size: 0.875rem;
}

.code-block {
  background: var(--gray-900);
  color: #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.75rem;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.code-block .comment { color: #6b7280; }
.code-block .key { color: #93c5fd; }
.code-block .string { color: #86efac; }
.code-block .number { color: #fcd34d; }

/* Token Info */
.token-info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
}

.token-stat {
  padding: 0.75rem;
  background: var(--gray-50);
  border-radius: 8px;
  text-align: center;
}

.token-stat .label {
  font-size: 0.7rem;
  color: var(--gray-600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.token-stat .value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--gray-800);
}

/* Activity Log */
.activity-log {
  max-height: 200px;
  overflow-y: auto;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--gray-100);
  font-size: 0.8rem;
}

.log-time {
  color: var(--gray-600);
  font-family: monospace;
  flex-shrink: 0;
}

.log-message {
  color: var(--gray-800);
}

/* Modal */
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-overlay.active {
  display: flex;
}

.modal {
  background: white;
  border-radius: 12px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--gray-200);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-body {
  padding: 1.5rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--gray-600);
}
`;

// =============================================================================
// Client-Side JavaScript
// =============================================================================

const CLIENT_SCRIPTS = `
// Security feature details for modal
const securityDetails = {
  pkce: {
    title: 'PKCE (Proof Key for Code Exchange)',
    content: '<p><strong>Prevents:</strong> Authorization code interception attacks</p><br/>' +
      '<p><strong>How:</strong></p>' +
      '<ol style="margin:0.5rem 0 0 1.5rem;font-size:0.875rem">' +
      '<li>Generate random code_verifier (43-128 chars)</li>' +
      '<li>Create code_challenge = SHA-256(verifier)</li>' +
      '<li>Send challenge with auth request</li>' +
      '<li>Send verifier with token exchange</li>' +
      '<li>Clio verifies hash(verifier) === challenge</li>' +
      '</ol>'
  },
  state: {
    title: 'Signed State Parameter',
    content: '<p><strong>Prevents:</strong> CSRF and replay attacks</p><br/>' +
      '<p><strong>Structure:</strong> base64({userId, orgId, timestamp, verifier}) + HMAC-SHA256 signature</p><br/>' +
      '<p><strong>Validation:</strong> Signature must match, timestamp within 10 min</p>'
  },
  encryption: {
    title: 'AES-GCM Token Encryption',
    content: '<p><strong>Protects:</strong> Tokens at rest in DO storage</p><br/>' +
      '<p><strong>Algorithm:</strong> AES-256-GCM (Authenticated Encryption)</p><br/>' +
      '<p>GCM provides both confidentiality AND integrity - any tampering is detected.</p>'
  },
  isolation: {
    title: 'Durable Object Isolation',
    content: '<p><strong>Ensures:</strong> Complete tenant data separation</p><br/>' +
      '<ul style="margin:0.5rem 0 0 1.5rem;font-size:0.875rem">' +
      '<li>Each org gets its own DO instance</li>' +
      '<li>DO ID derived from org ID</li>' +
      '<li>No shared state between orgs</li>' +
      '<li>Cloudflare guarantees single-threaded execution</li>' +
      '</ul>'
  },
  refresh: {
    title: 'Automatic Token Refresh',
    content: '<p><strong>Two strategies:</strong></p><br/>' +
      '<p><strong>1. Proactive:</strong> Refresh if token expires within 5 min before API call</p>' +
      '<p><strong>2. Reactive:</strong> On 401, refresh and retry once</p>'
  },
  keys: {
    title: 'Per-User Key Derivation',
    content: '<p><strong>Provides:</strong> User-specific encryption even with shared master key</p><br/>' +
      '<p>userKey = PBKDF2(ENCRYPTION_KEY, "clio-token:" + userId, 100000 iterations)</p><br/>' +
      '<p>Supports key rotation via ENCRYPTION_KEY_OLD fallback.</p>'
  }
};

// Modal functions
function showDetail(feature) {
  const detail = securityDetails[feature];
  if (!detail) return;

  document.getElementById('modalTitle').textContent = detail.title;
  document.getElementById('modalBody').innerHTML = detail.content;
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal(event) {
  if (!event || event.target === document.getElementById('modalOverlay')) {
    document.getElementById('modalOverlay').classList.remove('active');
  }
}

// Activity log
function addLog(message) {
  const log = document.getElementById('activityLog');
  if (!log) return;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    '<span class="log-time">' + new Date().toLocaleTimeString() + '</span>' +
    '<span class="log-message">' + message + '</span>';
  log.insertBefore(entry, log.firstChild);
}

function clearLog() {
  const log = document.getElementById('activityLog');
  if (log) {
    log.innerHTML = '';
  }
  addLog('Log cleared');
}

// Clio actions
async function disconnect() {
  addLog('Disconnecting from Clio...');
  await fetch('/demo/clio/disconnect', { method: 'POST' });
  location.reload();
}

async function refreshToken() {
  addLog('Refreshing access token...');

  const response = await fetch('/demo/clio/refresh-token', { method: 'POST' });
  const data = await response.json();

  if (data.success) {
    addLog('Token refreshed successfully');
    setTimeout(() => location.reload(), 1000);
  } else {
    addLog('Token refresh failed: ' + (data.error || 'Unknown error'));
  }
}

async function refreshSchema() {
  addLog('Fetching schemas from Clio...');

  const response = await fetch('/demo/clio/refresh-schema', { method: 'POST' });
  const data = await response.json();

  if (data.success) {
    addLog('Cached ' + (data.count || 0) + ' schemas');
    setTimeout(() => location.reload(), 1000);
  } else {
    addLog('Schema refresh failed');
  }
}

async function testApi() {
  const objectType = document.getElementById('objectType').value;
  const operation = document.getElementById('operation').value;
  const recordId = document.getElementById('recordId').value;
  const output = document.getElementById('apiOutput');

  output.style.display = 'block';
  output.innerHTML = '<span class="comment">// Loading...</span>';

  addLog('Executing ' + operation + ' on ' + objectType + '...');

  try {
    const response = await fetch('/demo/clio/test-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objectType: objectType,
        operation: operation,
        id: recordId || undefined
      })
    });

    const data = await response.json();

    if (data.error) {
      output.innerHTML = '<span class="comment">// Error</span>\\n' + JSON.stringify(data, null, 2);
      addLog('API error: ' + data.error);
    } else {
      // Syntax highlight the JSON
      const formatted = JSON.stringify(data, null, 2)
        .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
        .replace(/: "([^"]+)"/g, ': <span class="string">"$1"</span>')
        .replace(/: (\\d+)/g, ': <span class="number">$1</span>');

      output.innerHTML = '<span class="comment">// Response from Clio API</span>\\n' + formatted;

      const count = Array.isArray(data.data) ? data.data.length + ' records' : '1 record';
      addLog('Received ' + count);
    }
  } catch (error) {
    output.innerHTML = '<span class="comment">// Network Error</span>\\n' + error.message;
    addLog('Network error: ' + error.message);
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    closeModal();
  }
});
`;
