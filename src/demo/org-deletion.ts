/**
 * Org Deletion Demo Page
 *
 * Demonstrates org deletion workflow: preview what will be deleted,
 * then permanently delete the org and all associated data.
 */

import { renderPage, createPostScript } from "./shared";

// =============================================================================
// Templates
// =============================================================================

const FORM_CONTENT = `
  <div class="card">
    <div class="status" style="background: #fef3c7; color: #92400e">
      Permanently deletes org and all data.
    </div>
  </div>

  <div class="card">
    <h2>Preview</h2>
    <div class="form-group">
      <label>Org ID</label>
      <input id="preview-org-id" class="input">
    </div>
    <button
      class="btn btn-secondary"
      onclick="post('preview', { orgId: document.getElementById('preview-org-id').value }).then(r => showResult('preview-result', r))"
    >Preview</button>
    <div id="preview-result" class="result"></div>
  </div>

  <div class="card">
    <h2>Delete</h2>
    <div class="form-group">
      <label>Org ID</label>
      <input id="delete-org-id" class="input">
    </div>
    <div class="form-group">
      <label>Owner ID</label>
      <input id="delete-owner-id" class="input">
    </div>
    <button
      class="btn btn-danger"
      onclick="if (confirm('Delete this organization?')) post('delete', { orgId: document.getElementById('delete-org-id').value, userId: document.getElementById('delete-owner-id').value }).then(r => showResult('delete-result', r))"
    >Delete</button>
    <div id="delete-result" class="result"></div>
  </div>
`;

// =============================================================================
// Page Builder
// =============================================================================

export function buildOrgDeletionPage(): string {
  return renderPage({
    title: "Org Deletion",
    subtitle: "D1 + R2 Cleanup",
    body: FORM_CONTENT,
    script: createPostScript("/demo/org-deletion"),
  });
}
