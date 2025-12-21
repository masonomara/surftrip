/**
 * Tenant DO Demo Page
 *
 * Demonstrates Durable Object message processing, conversation isolation,
 * permission enforcement, and user lifecycle handlers.
 */

import { renderPage, createPostScript } from "./shared";

const FORM_CONTENT = `
  <div class="card">
    <div class="status" style="background: #e0f2fe; color: #0369a1">
      Tests DO message processing, conversation isolation, and user lifecycle operations.
    </div>
  </div>

  <div class="card">
    <h2>Process Message</h2>
    <div class="form-group">
      <label>Org ID</label>
      <input id="msg-org-id" class="input" value="demo-org-1">
    </div>
    <div class="form-group">
      <label>User ID</label>
      <input id="msg-user-id" class="input" value="user-123">
    </div>
    <div class="form-group">
      <label>Conversation ID</label>
      <input id="msg-conv-id" class="input" value="conv-abc">
    </div>
    <div class="form-group">
      <label>Role</label>
      <select id="msg-role" class="input">
        <option value="admin">Admin</option>
        <option value="member">Member</option>
      </select>
    </div>
    <div class="form-group">
      <label>Message</label>
      <input id="msg-text" class="input" value="What are the billing best practices?">
    </div>
    <button class="btn btn-primary" onclick="sendMessage()">Send Message</button>
    <div id="msg-result" class="result"></div>
  </div>

  <div class="card">
    <h2>DO Status</h2>
    <div class="form-group">
      <label>Org ID</label>
      <input id="status-org-id" class="input" value="demo-org-1">
    </div>
    <button
      class="btn btn-secondary"
      onclick="post('status', { orgId: document.getElementById('status-org-id').value }).then(r => showResult('status-result', r))"
    >Get Status</button>
    <div id="status-result" class="result"></div>
  </div>

  <div class="card">
    <h2>User Leave Org</h2>
    <p style="color: #64748b; font-size: 14px; margin-bottom: 12px;">
      Expires pending confirmations and deletes Clio token from DO storage.
    </p>
    <div class="form-group">
      <label>Org ID</label>
      <input id="leave-org-id" class="input" value="demo-org-1">
    </div>
    <div class="form-group">
      <label>User ID</label>
      <input id="leave-user-id" class="input" value="user-123">
    </div>
    <button
      class="btn btn-danger"
      onclick="post('user-leave', { orgId: document.getElementById('leave-org-id').value, userId: document.getElementById('leave-user-id').value }).then(r => showResult('leave-result', r))"
    >User Leave</button>
    <div id="leave-result" class="result"></div>
  </div>

  <div class="card">
    <h2>GDPR Purge</h2>
    <p style="color: #64748b; font-size: 14px; margin-bottom: 12px;">
      Deletes all user messages and expires confirmations. Audit log anonymized.
    </p>
    <div class="form-group">
      <label>Org ID</label>
      <input id="gdpr-org-id" class="input" value="demo-org-1">
    </div>
    <div class="form-group">
      <label>User ID</label>
      <input id="gdpr-user-id" class="input" value="user-123">
    </div>
    <button
      class="btn btn-danger"
      onclick="post('gdpr-purge', { orgId: document.getElementById('gdpr-org-id').value, userId: document.getElementById('gdpr-user-id').value }).then(r => showResult('gdpr-result', r))"
    >GDPR Purge</button>
    <div id="gdpr-result" class="result"></div>
  </div>
`;

const EXTRA_SCRIPT = `
  async function sendMessage() {
    const orgId = document.getElementById('msg-org-id').value;
    const message = {
      channel: 'web',
      orgId: orgId,
      userId: document.getElementById('msg-user-id').value,
      userRole: document.getElementById('msg-role').value,
      conversationId: document.getElementById('msg-conv-id').value,
      conversationScope: 'personal',
      message: document.getElementById('msg-text').value,
      jurisdiction: null,
      practiceType: null,
      firmSize: null
    };
    const result = await post('process-message', { orgId, message });
    showResult('msg-result', result);
  }
`;

export function buildTenantDOPage(): string {
  return renderPage({
    title: "Tenant Durable Object",
    subtitle: "Phase 6: Message Processing & User Lifecycle",
    body: FORM_CONTENT,
    script: createPostScript("/demo/tenant-do") + EXTRA_SCRIPT,
  });
}
