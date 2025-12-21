/**
 * Knowledge Base Demo Page
 *
 * Demonstrates RAG functionality: querying the KB with filters,
 * uploading org context documents, and rebuilding the KB index.
 */

import { renderPage } from "./shared";

// =============================================================================
// Styles
// =============================================================================

const KB_CSS = `
  .stats {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
  }

  .stat {
    background: #e0f2fe;
    padding: 12px 16px;
    border-radius: 8px;
    text-align: center;
    flex: 1;
  }

  .stat-value {
    font-size: 24px;
    font-weight: bold;
    color: #0369a1;
  }

  .stat-label {
    font-size: 12px;
    color: #64748b;
  }

  .formatted {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 16px;
    margin-top: 16px;
  }

  .formatted h3 {
    font-size: 14px;
    margin-bottom: 8px;
    color: #333;
  }

  .formatted pre {
    white-space: pre-wrap;
    font-size: 13px;
  }

  .filter-row {
    display: flex;
    gap: 12px;
  }

  .filter-row .form-group {
    flex: 1;
  }
`;

// =============================================================================
// Scripts
// =============================================================================

const KB_SCRIPT = `
  async function runQuery() {
    const query = document.getElementById('query').value;
    const orgId = document.getElementById('orgId').value;
    const jurisdiction = document.getElementById('jurisdiction').value || null;
    const practiceType = document.getElementById('practiceType').value || null;
    const firmSize = document.getElementById('firmSize').value || null;

    const response = await fetch('/demo/kb?action=query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, orgId, jurisdiction, practiceType, firmSize })
    });

    const data = await response.json();

    // Show stats
    document.getElementById('stats').innerHTML =
      '<div class="stat">' +
        '<div class="stat-value">' + data.stats.kbChunks + '</div>' +
        '<div class="stat-label">KB Chunks</div>' +
      '</div>' +
      '<div class="stat">' +
        '<div class="stat-value">' + data.stats.orgChunks + '</div>' +
        '<div class="stat-label">Org Chunks</div>' +
      '</div>';
    document.getElementById('stats').style.display = 'flex';

    // Show formatted context
    document.getElementById('formatted').innerHTML =
      '<h3>Formatted Context</h3>' +
      '<pre>' + (data.formatted || '(empty)') + '</pre>';
    document.getElementById('formatted').style.display = 'block';

    // Show raw JSON
    document.getElementById('raw').textContent = JSON.stringify(data.raw, null, 2);
    document.getElementById('raw').style.display = 'block';
  }

  async function uploadFile() {
    const orgId = document.getElementById('uploadOrgId').value;
    const fileInput = document.getElementById('file');
    const file = fileInput.files[0];

    if (!file) {
      alert('Select a file');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('orgId', orgId);

    const response = await fetch('/demo/kb?action=upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    document.getElementById('uploadResult').textContent = JSON.stringify(data, null, 2);
    document.getElementById('uploadResult').style.display = 'block';
  }

  async function rebuildKB() {
    const btn = document.getElementById('rebuild-button');
    const resultEl = document.getElementById('rebuild-result');

    btn.disabled = true;
    btn.textContent = 'Building...';
    resultEl.style.display = 'none';

    try {
      const response = await fetch('/demo/kb?action=rebuild', { method: 'POST' });
      const data = await response.json();
      resultEl.textContent = JSON.stringify(data, null, 2);
      resultEl.style.display = 'block';
    } catch (error) {
      resultEl.textContent = 'Error: ' + error.message;
      resultEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Rebuild';
    }
  }

  async function loadStatus() {
    try {
      const response = await fetch('/demo/kb?action=status');
      const data = await response.json();
      document.getElementById('status').innerHTML =
        '<p>D1: ' + data.d1Count + ' KB chunks</p>' +
        '<p>Vectorize: ' + data.vectorizeCount + ' vectors</p>';
    } catch (error) {
      document.getElementById('status').textContent = 'Error: ' + error.message;
    }
  }

  // Load status on page load
  loadStatus();
`;

// =============================================================================
// Templates
// =============================================================================

interface KBStats {
  totalFiles: number;
  byCategory: Record<string, number>;
}

function buildQuerySection(): string {
  return `
    <div class="card">
      <h2>Test RAG Query</h2>

      <div class="form-group">
        <label>Query</label>
        <input id="query" class="input" placeholder="How do I calculate statute of limitations?">
      </div>

      <div class="form-group">
        <label>Org ID</label>
        <input id="orgId" class="input" value="test-org">
      </div>

      <div class="filter-row">
        <div class="form-group">
          <label>Jurisdiction</label>
          <select id="jurisdiction" class="input">
            <option value="">(Not set)</option>
            <option value="federal">Federal</option>
            <option value="CA">California</option>
            <option value="NY">New York</option>
            <option value="TX">Texas</option>
          </select>
        </div>

        <div class="form-group">
          <label>Practice Type</label>
          <select id="practiceType" class="input">
            <option value="">(Not set)</option>
            <option value="personal-injury">Personal Injury</option>
            <option value="family-law">Family Law</option>
          </select>
        </div>

        <div class="form-group">
          <label>Firm Size</label>
          <select id="firmSize" class="input">
            <option value="">(Not set)</option>
            <option value="solo">Solo</option>
            <option value="small">Small</option>
            <option value="mid">Mid</option>
          </select>
        </div>
      </div>

      <button class="btn btn-primary" onclick="runQuery()">Query RAG</button>

      <div id="stats" class="stats" style="display: none"></div>
      <div id="formatted" class="formatted" style="display: none"></div>
      <div id="raw" class="result" style="display: none"></div>
    </div>
  `;
}

function buildUploadSection(): string {
  return `
    <div class="card">
      <h2>Upload Org Context</h2>

      <div class="form-group">
        <label>Org ID</label>
        <input id="uploadOrgId" class="input" value="test-org">
      </div>

      <div class="form-group">
        <label>File</label>
        <input type="file" id="file" accept=".pdf,.docx,.xlsx,.pptx,.odt,.ods,.md,.txt,.html,.csv,.xml">
      </div>

      <button class="btn btn-secondary" onclick="uploadFile()">Upload</button>

      <div id="uploadResult" class="result" style="display: none"></div>
    </div>
  `;
}

function buildManagementSection(stats: KBStats): string {
  const badges = Object.entries(stats.byCategory)
    .map(
      ([category, count]) =>
        `<span style="background: #e0f2fe; color: #0369a1; padding: 6px 12px; border-radius: 6px; font-size: 13px">${category}: ${count}</span>`
    )
    .join(" ");

  return `
    <div class="card">
      <h2>KB Management</h2>

      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 16px">
        <div style="font-size: 24px; font-weight: bold; color: #3b82f6">${stats.totalFiles}</div>
        <div style="font-size: 12px; color: #64748b">Source Files</div>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px">
        ${badges}
      </div>

      <button id="rebuild-button" class="btn btn-secondary" onclick="rebuildKB()">Rebuild</button>
      <p style="font-size: 12px; color: #64748b; margin-top: 8px">Note: Vectorize has eventual consistency.</p>

      <div id="rebuild-result" class="result"></div>
    </div>
  `;
}

function buildStatusSection(): string {
  return `
    <div class="card">
      <h2>Status</h2>
      <div id="status" style="font-size: 14px; color: #64748b">Loading...</div>
    </div>
  `;
}

// =============================================================================
// Page Builder
// =============================================================================

export function buildKBPage(stats: KBStats): string {
  const body = [
    buildQuerySection(),
    buildUploadSection(),
    buildManagementSection(stats),
    buildStatusSection(),
  ].join("\n");

  return renderPage({
    title: "Docket Knowledge Base",
    subtitle: "Phase 5: RAG Demo",
    body,
    script: KB_SCRIPT,
    extraCSS: KB_CSS,
  });
}
