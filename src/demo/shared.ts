/**
 * Shared Demo Page Utilities
 *
 * Base styles and helper functions used across all demo pages.
 */

// =============================================================================
// Base Styles
// =============================================================================

export const BASE_CSS = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: Inter, -apple-system, sans-serif;
    background: #f7f7f7;
    padding: 40px 20px;
  }

  .container {
    max-width: 600px;
    margin: 0 auto;
  }

  h1 {
    font-size: 1.5rem;
    margin-bottom: 8px;
  }

  .subtitle {
    color: #64748b;
    margin-bottom: 24px;
  }

  .card {
    background: #fff;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  .card h2 {
    font-size: 1rem;
    margin-bottom: 16px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .form-group {
    margin-bottom: 12px;
  }

  .form-group label {
    display: block;
    margin-bottom: 4px;
    font-size: 14px;
    color: #64748b;
  }

  .input {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    margin: 4px;
  }

  .btn-primary {
    background: #3b82f6;
    color: #fff;
  }

  .btn-secondary {
    background: #64748b;
    color: #fff;
  }

  .btn-danger {
    background: #ef4444;
    color: #fff;
  }

  .btn:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }

  .result {
    background: #f5f5f5;
    border-radius: 8px;
    padding: 16px;
    font-family: monospace;
    font-size: 13px;
    white-space: pre-wrap;
    margin-top: 16px;
    display: none;
  }

  .status {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 14px;
    margin-bottom: 16px;
  }
`;

// =============================================================================
// Page Rendering
// =============================================================================

interface PageOptions {
  title: string;
  subtitle: string;
  body: string;
  script: string;
  extraCSS?: string;
}

/**
 * Renders a complete HTML page with consistent structure.
 */
export function renderPage(options: PageOptions): string {
  const { title, subtitle, body, script, extraCSS = "" } = options;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${BASE_CSS}${extraCSS}</style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    ${body}
  </div>
  <script>${script}</script>
</body>
</html>`;
}

// =============================================================================
// Script Helpers
// =============================================================================

/**
 * Creates a standard POST helper script for form submissions.
 */
export function createPostScript(endpoint: string): string {
  return `
    async function post(action, data) {
      const response = await fetch('${endpoint}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      });
      return response.json();
    }

    function showResult(elementId, data) {
      const element = document.getElementById(elementId);
      element.textContent = JSON.stringify(data, null, 2);
      element.style.display = 'block';
    }
  `;
}
