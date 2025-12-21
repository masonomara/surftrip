/**
 * Org Membership Demo Page
 *
 * Demonstrates org membership operations: viewing members,
 * removing users, and transferring ownership.
 */

import { renderPage, createPostScript } from "./shared";

// =============================================================================
// Templates
// =============================================================================

const FORM_CONTENT = `
  <div class="card">
    <div class="status" style="background: #e0f2fe; color: #0369a1">
      Tests D1 cleanup when users leave orgs.
    </div>
  </div>

  <div class="card">
    <h2>Get Members</h2>
    <div class="form-group">
      <label>Org ID</label>
      <input id="members-org-id" class="input">
    </div>
    <button
      class="btn btn-secondary"
      onclick="post('get-members', { orgId: document.getElementById('members-org-id').value }).then(r => showResult('members-result', r))"
    >Get</button>
    <div id="members-result" class="result"></div>
  </div>

  <div class="card">
    <h2>Get Membership</h2>
    <div class="form-group">
      <label>User ID</label>
      <input id="membership-user-id" class="input">
    </div>
    <div class="form-group">
      <label>Org ID</label>
      <input id="membership-org-id" class="input">
    </div>
    <button
      class="btn btn-secondary"
      onclick="post('get-membership', { userId: document.getElementById('membership-user-id').value, orgId: document.getElementById('membership-org-id').value }).then(r => showResult('membership-result', r))"
    >Get</button>
    <div id="membership-result" class="result"></div>
  </div>

  <div class="card">
    <h2>Remove User</h2>
    <div class="form-group">
      <label>User ID</label>
      <input id="remove-user-id" class="input">
    </div>
    <div class="form-group">
      <label>Org ID</label>
      <input id="remove-org-id" class="input">
    </div>
    <button
      class="btn btn-danger"
      onclick="post('remove', { userId: document.getElementById('remove-user-id').value, orgId: document.getElementById('remove-org-id').value }).then(r => showResult('remove-result', r))"
    >Remove</button>
    <div id="remove-result" class="result"></div>
  </div>

  <div class="card">
    <h2>Transfer Ownership</h2>
    <div class="form-group">
      <label>From User</label>
      <input id="transfer-from-user" class="input">
    </div>
    <div class="form-group">
      <label>To User</label>
      <input id="transfer-to-user" class="input">
    </div>
    <div class="form-group">
      <label>Org ID</label>
      <input id="transfer-org-id" class="input">
    </div>
    <button
      class="btn btn-primary"
      onclick="post('transfer', { userId: document.getElementById('transfer-from-user').value, toUserId: document.getElementById('transfer-to-user').value, orgId: document.getElementById('transfer-org-id').value }).then(r => showResult('transfer-result', r))"
    >Transfer</button>
    <div id="transfer-result" class="result"></div>
  </div>
`;

// =============================================================================
// Page Builder
// =============================================================================

export function buildOrgMembershipPage(): string {
  return renderPage({
    title: "Org Membership",
    subtitle: "User Leaves Org Flow",
    body: FORM_CONTENT,
    script: createPostScript("/demo/org-membership"),
  });
}
