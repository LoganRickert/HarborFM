import { APP_NAME } from "./config.js";

/**
 * APP_NAME-branded theme for Swagger UI (/api/docs).
 * Colors and font match the web app (dark mode, accent #00d4aa).
 */
export const SWAGGER_TITLE = `${APP_NAME} API`;

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

.swagger-ui .opblock-section-header,
.swagger-ui .opblock-section-header h4 {
  background: #14171e !important;
  border-color: #2a2f3d !important;
  color: #fff !important;
}

.swagger-ui .response-control-media-type__accept-message {
  color: #e8eaef !important;
}

.swagger-ui .renderedMarkdown > * {
  color: #fff !important;
}

.swagger-ui .opblock-description-wrapper,
.swagger-ui .opblock-description-wrapper > *,
.swagger-ui .curl-command > *,
.swagger-ui .javascript-command > *,
.swagger-ui .python-command > *,
.swagger-ui .ruby-command > *,
.swagger-ui .php-command > *,
.swagger-ui .java-command > *,
.swagger-ui .go-command > *,
.swagger-ui .swift-command > *,
.swagger-ui .kotlin-command > *,
.swagger-ui .request-url > *,
.swagger-ui .responses-inner h4,
.swagger-ui .responses-inner h5,
.swagger-ui .responses-inner h6,
.swagger-ui .opblock-title,
.swagger-ui .parameter__name,
.swagger-ui .parameter__type,
.swagger-ui .parameter__in,
.swagger-ui .col_header.response-col_status,
.swagger-ui .response-col_status {
  color: #e8eaef !important;
}

.swagger-ui .opblock-control-arrow,
.swagger-ui .expand-operation {
  color: #fff !important;
}

.swagger-ui .opblock-control-arrow svg,
.swagger-ui .opblock-control-arrow path,
.swagger-ui .expand-operation svg,
.swagger-ui .expand-operation path {
  fill: #fff !important;
}

.swagger-ui .opblock-summary .authorization__btn,
.swagger-ui .opblock-summary .locked svg,
.swagger-ui .opblock-summary .locked path,
.swagger-ui .opblock-summary [class*="lock"] svg,
.swagger-ui .opblock-summary [class*="lock"] path {
  fill: #e8eaef !important;
  color: #e8eaef !important;
}

.swagger-ui .opblock-summary svg,
.swagger-ui .opblock-summary path {
  fill: #e8eaef !important;
}

.swagger-ui .btn {
  border-radius: 8px !important;
  font-family: 'DM Sans', system-ui, sans-serif !important;
  background: #1a1e28 !important;
  border: 1px solid #2a2f3d !important;
  color: #e8eaef !important;
}

.swagger-ui .btn:hover {
  background: #2a2f3d !important;
  border-color: #3d4454 !important;
  color: #fff !important;
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
  background: #1a1e28 !important;
  border-color: #2a2f3d !important;
  color: #8b92a3 !important;
}

.swagger-ui .btn.cancel:hover {
  background: #2a2f3d !important;
  color: #e8eaef !important;
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
  background: white !important;
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
  width: 100%;
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

.swagger-ui .scheme-container,
.swagger-ui .schemes > .scheme-container {
  background: #14171e !important;
  border: 1px solid #2a2f3d !important;
  border-radius: 8px !important;
}

.swagger-ui .scheme-container .scheme-title,
.swagger-ui .scheme-container label {
  color: #e8eaef !important;
}

.swagger-ui .modal-ux,
.swagger-ui .modal-ux-content,
.swagger-ui .dialog-ux .modal-ux-content {
  background: #14171e !important;
  border: 1px solid #2a2f3d !important;
}

/* Model/schema panel (modal and inline) */
.swagger-ui .model-container {
  background: #14171e !important;
  border: 1px solid #2a2f3d !important;
  border-radius: 8px !important;
  color: #e8eaef !important;
}

.swagger-ui .model-container .model-box {
  background: #1a1e28 !important;
  border-color: #2a2f3d !important;
  color: #e8eaef !important;
}

.swagger-ui .model-container .model,
.swagger-ui .model-container .property-row td,
.swagger-ui .model-container .brace-open,
.swagger-ui .model-container .brace-close {
  color: #e8eaef !important;
}

.swagger-ui .model-container table.model {
  border-color: #2a2f3d !important;
}

.swagger-ui .model-container table.model td {
  border-color: #2a2f3d !important;
  color: #e8eaef !important;
}

.swagger-ui .model-container .model-box-control {
  background: transparent !important;
  border: none !important;
  color: #00d4aa !important;
}

.swagger-ui .model-container .model-toggle {
  color: #00d4aa !important;
}

.swagger-ui .model-container .model-toggle.collapsed {
  color: #8b92a3 !important;
}

.swagger-ui .prop-type {
  color: #8b92a3 !important;
}

.swagger-ui .model-container .model .prop {
  padding: 10px;
}

.swagger-ui .model-container .model .prop .renderedMarkdown {
  padding: 10px 0;
}

.swagger-ui .btn-group {
  gap: 10px;
}

`;
