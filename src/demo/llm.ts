/**
 * LLM Demo Page
 *
 * Demonstrates Workers AI integration, RAG context retrieval,
 * tool calling, and CUD confirmation flow.
 */

import { renderPage, createPostScript } from "./shared";

const FORM_CONTENT = `
  <div class="card">
    <div class="status" style="background: #e0f2fe; color: #0369a1">
      Tests LLM inference, RAG context, tool calling, and confirmation flow.
    </div>
  </div>

  <div class="card">
    <h2>Chat with Docket</h2>
    <div class="form-group">
      <label>Org ID</label>
      <input id="chat-org-id" class="input" value="demo-org-1">
    </div>
    <div class="form-group">
      <label>User ID</label>
      <input id="chat-user-id" class="input" value="user-123">
    </div>
    <div class="form-group">
      <label>Conversation ID</label>
      <input id="chat-conv-id" class="input" value="conv-llm-demo">
    </div>
    <div class="form-group">
      <label>Role</label>
      <select id="chat-role" class="input">
        <option value="admin">Admin</option>
        <option value="member">Member</option>
      </select>
    </div>
    <div class="form-group">
      <label>Jurisdiction</label>
      <select id="chat-jurisdiction" class="input">
        <option value="">None</option>
        <option value="federal">Federal</option>
        <option value="CA">California</option>
        <option value="NY">New York</option>
        <option value="TX">Texas</option>
      </select>
    </div>
    <div class="form-group">
      <label>Practice Type</label>
      <select id="chat-practice" class="input">
        <option value="">None</option>
        <option value="litigation">Litigation</option>
        <option value="corporate">Corporate</option>
        <option value="family">Family Law</option>
      </select>
    </div>
    <div id="chat-messages" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; min-height: 200px; max-height: 400px; overflow-y: auto; margin-bottom: 16px;">
      <p style="color: #94a3b8; text-align: center;">Send a message to start chatting...</p>
    </div>
    <div style="display: flex; gap: 8px;">
      <input id="chat-input" class="input" placeholder="Ask about case management, deadlines, or Clio data..." style="flex: 1;">
      <button class="btn btn-primary" onclick="sendChat()">Send</button>
    </div>
  </div>

  <div class="card">
    <h2>Example Prompts</h2>
    <div style="display: grid; gap: 8px;">
      <button class="btn btn-secondary" onclick="setPrompt('What are the best practices for billing?')">
        Billing Best Practices (uses KB)
      </button>
      <button class="btn btn-secondary" onclick="setPrompt('Show me my open matters')">
        Query Clio Matters (uses tool)
      </button>
      <button class="btn btn-secondary" onclick="setPrompt('Create a new task for matter review')">
        Create Task (requires confirmation)
      </button>
      <button class="btn btn-secondary" onclick="setPrompt('How do I calculate statute of limitations?')">
        Deadline Calculation (uses KB)
      </button>
    </div>
  </div>

  <div class="card">
    <h2>DO Status</h2>
    <button class="btn btn-secondary" onclick="getStatus()">Get Status</button>
    <div id="status-result" class="result"></div>
  </div>

  <div class="card">
    <h2>Reset Conversation</h2>
    <p style="color: #64748b; font-size: 14px; margin-bottom: 12px;">
      Clears the chat display (messages remain in DO storage).
    </p>
    <button class="btn btn-danger" onclick="resetChat()">Reset</button>
  </div>
`;

const EXTRA_SCRIPT = `
  function setPrompt(text) {
    document.getElementById('chat-input').value = text;
    document.getElementById('chat-input').focus();
  }

  function addMessage(role, content, data) {
    const container = document.getElementById('chat-messages');
    if (container.querySelector('p[style*="text-align: center"]')) {
      container.innerHTML = '';
    }

    const msg = document.createElement('div');
    msg.style.marginBottom = '12px';
    msg.style.padding = '8px 12px';
    msg.style.borderRadius = '6px';

    if (role === 'user') {
      msg.style.background = '#3b82f6';
      msg.style.color = 'white';
      msg.style.marginLeft = '20%';
    } else {
      msg.style.background = 'white';
      msg.style.border = '1px solid #e2e8f0';
      msg.style.marginRight = '20%';
    }

    msg.innerHTML = '<strong>' + (role === 'user' ? 'You' : 'Docket') + ':</strong> ' + content.replace(/\\n/g, '<br>');

    if (data && Object.keys(data).length > 0) {
      const details = document.createElement('details');
      details.style.marginTop = '8px';
      details.style.fontSize = '12px';
      details.style.color = '#64748b';
      details.innerHTML = '<summary style="cursor: pointer;">Debug Info</summary><pre style="margin: 4px 0; white-space: pre-wrap;">' + JSON.stringify(data, null, 2) + '</pre>';
      msg.appendChild(details);
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  async function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    addMessage('user', message);
    input.value = '';

    const orgId = document.getElementById('chat-org-id').value;
    const jurisdiction = document.getElementById('chat-jurisdiction').value || null;
    const practiceType = document.getElementById('chat-practice').value || null;

    const payload = {
      orgId,
      message: {
        channel: 'web',
        orgId: orgId,
        userId: document.getElementById('chat-user-id').value,
        userRole: document.getElementById('chat-role').value,
        conversationId: document.getElementById('chat-conv-id').value,
        conversationScope: 'personal',
        message: message,
        jurisdiction: jurisdiction,
        practiceType: practiceType,
        firmSize: null
      }
    };

    try {
      const result = await post('process-message', payload);
      if (result.success && result.responseText) {
        addMessage('assistant', result.responseText, result.data || result.pendingConfirmation);
      } else {
        addMessage('assistant', result.error || 'Something went wrong', result);
      }
    } catch (err) {
      addMessage('assistant', 'Error: ' + err.message, null);
    }
  }

  async function getStatus() {
    const orgId = document.getElementById('chat-org-id').value;
    const result = await post('status', { orgId });
    showResult('status-result', result);
  }

  function resetChat() {
    document.getElementById('chat-messages').innerHTML = '<p style="color: #94a3b8; text-align: center;">Send a message to start chatting...</p>';
    document.getElementById('chat-conv-id').value = 'conv-' + Date.now();
  }

  document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendChat();
  });
`;

export function buildLLMPage(): string {
  return renderPage({
    title: "Workers AI + RAG",
    subtitle: "Phase 7: LLM Integration & Tool Calling",
    body: FORM_CONTENT,
    script: createPostScript("/demo/llm") + EXTRA_SCRIPT,
  });
}
