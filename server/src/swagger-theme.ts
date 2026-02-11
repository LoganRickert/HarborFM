/**
 * HarborFM-branded theme for Swagger UI (/api/docs).
 * Colors and font match the web app (dark mode, accent #00d4aa).
 */
export const SWAGGER_TITLE = 'HarborFM API';

export const SWAGGER_THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');

body {
  background: #0c0e12 !important;
  color: #e8eaef !important;
}

.swagger-ui {
  font-family: 'DM Sans', system-ui, sans-serif !important;
  color: #e8eaef !important;
}

.swagger-ui .topbar {
  background: #14171e !important;
  border-bottom: 1px solid #2a2f3d !important;
}

.swagger-ui .topbar .link {
  color: #00d4aa !important;
}

.swagger-ui .info .title {
  color: #e8eaef !important;
}

.swagger-ui .info p, .swagger-ui .info table td, .swagger-ui .info li {
  color: #8b92a3 !important;
}

.swagger-ui .opblock {
  border: 1px solid #2a2f3d !important;
  border-radius: 8px !important;
  margin-bottom: 0.5rem !important;
}

.swagger-ui .opblock.opblock-get {
  background: rgba(0, 212, 170, 0.08) !important;
  border-color: rgba(0, 212, 170, 0.3) !important;
}

.swagger-ui .opblock.opblock-post {
  background: rgba(0, 212, 170, 0.08) !important;
  border-color: rgba(0, 212, 170, 0.3) !important;
}

.swagger-ui .opblock.opblock-put,
.swagger-ui .opblock.opblock-patch {
  background: rgba(0, 212, 170, 0.06) !important;
  border-color: rgba(0, 212, 170, 0.25) !important;
}

.swagger-ui .opblock.opblock-delete {
  background: rgba(255, 107, 107, 0.08) !important;
  border-color: rgba(255, 107, 107, 0.3) !important;
}

.swagger-ui .opblock .opblock-summary-method {
  border-radius: 6px !important;
}

.swagger-ui .opblock .opblock-summary-path,
.swagger-ui .opblock .opblock-summary-description {
  color: #e8eaef !important;
}

.swagger-ui .btn {
  border-radius: 8px !important;
  font-family: 'DM Sans', system-ui, sans-serif !important;
}

.swagger-ui .btn.execute {
  background: #00d4aa !important;
  border-color: #00d4aa !important;
  color: #0c0e12 !important;
}

.swagger-ui .btn.execute:hover {
  background: #00a884 !important;
  border-color: #00a884 !important;
}

.swagger-ui .btn.cancel {
  border-color: #2a2f3d !important;
  color: #8b92a3 !important;
}

.swagger-ui input[type=text],
.swagger-ui input[type=password],
.swagger-ui textarea,
.swagger-ui select {
  background: #1a1e28 !important;
  border: 1px solid #2a2f3d !important;
  color: #e8eaef !important;
  border-radius: 8px !important;
}

.swagger-ui .model-box-control,
.swagger-ui .model-toggle {
  background: #14171e !important;
  color: #00d4aa !important;
  border: 1px solid #2a2f3d !important;
}

.swagger-ui table thead tr th,
.swagger-ui table thead tr td {
  border-color: #2a2f3d !important;
  color: #8b92a3 !important;
}

.swagger-ui table tbody tr td {
  border-color: #2a2f3d !important;
  color: #e8eaef !important;
}

.swagger-ui .response-col_status {
  color: #8b92a3 !important;
}

.swagger-ui .response-col_links {
  color: #00d4aa !important;
}

.swagger-ui a {
  color: #00d4aa !important;
}

.swagger-ui section.models {
  border: 1px solid #2a2f3d !important;
  border-radius: 8px !important;
}

.swagger-ui .model-box {
  background: #14171e !important;
}

.swagger-ui .tab li {
  color: #8b92a3 !important;
}

.swagger-ui .tab li.active {
  color: #00d4aa !important;
}

.swagger-ui .info .link {
  color: #00d4aa !important;
}

.swagger-ui .loading-container .loading::after {
  border-color: #00d4aa transparent transparent !important;
}
`;
