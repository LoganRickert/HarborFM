/**
 * E2E test runner: runs all test suites, collects results, prints summary, writes report.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = __dirname;
const REPORTS_DIR = join(E2E_DIR, 'reports');

function now() {
  return Date.now();
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Run a single test and return result. */
async function runOne(name, fn) {
  const start = now();
  try {
    await fn();
    return { name, status: 'passed', durationMs: now() - start };
  } catch (err) {
    return {
      name,
      status: 'failed',
      durationMs: now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Print progress for a suite. */
function printSuiteProgress(suiteName, results) {
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skip = results.filter((r) => r.status === 'skipped').length;
  let msg = `  ${suiteName}: ${passed} passed`;
  if (failed) msg += `, ${failed} failed`;
  if (skip) msg += `, ${skip} skipped`;
  console.log(msg);
}

/** Write e2e-report.json */
function writeJsonReport(allResults, totalDurationMs) {
  const passed = allResults.filter((r) => r.status === 'passed').length;
  const failed = allResults.filter((r) => r.status === 'failed').length;
  const skipped = allResults.filter((r) => r.status === 'skipped').length;
  const report = {
    passed,
    failed,
    skipped,
    total: allResults.length,
    durationMs: totalDurationMs,
    results: allResults,
  };
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, 'e2e-report.json'), JSON.stringify(report, null, 2));
}

/** Write e2e-report.md (human-readable Markdown). */
function writeMarkdownReport(allResults, totalDurationMs) {
  const passed = allResults.filter((r) => r.status === 'passed').length;
  const failed = allResults.filter((r) => r.status === 'failed').length;
  const skipped = allResults.filter((r) => r.status === 'skipped').length;
  const total = allResults.length;
  const status = failed > 0 ? 'FAIL' : 'PASS';

  const bySuite = new Map();
  for (const r of allResults) {
    const suite = r.suite || 'Other';
    if (!bySuite.has(suite)) bySuite.set(suite, []);
    bySuite.get(suite).push(r);
  }

  const lines = [
    '# E2E Test Report',
    '',
    `**Date:** ${new Date().toISOString()}`,
    `**Duration:** ${formatDuration(totalDurationMs)}`,
    '',
    '## Summary',
    '',
    '| Status | Count |',
    '|--------|-------|',
    `| Passed | ${passed} |`,
    `| Failed | ${failed} |`,
    `| Skipped | ${skipped} |`,
    `| **Total** | **${total}** |`,
    '',
    `**Result:** ${status === 'PASS' ? 'PASS' : '**FAIL**'}`,
    '',
    '---',
    '',
    '## Results by suite',
    '',
  ];

  for (const [suiteName, results] of [...bySuite.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const suitePassed = results.filter((r) => r.status === 'passed').length;
    const suiteFailed = results.filter((r) => r.status === 'failed').length;
    const badge = suiteFailed > 0 ? '❌' : '✅';
    lines.push(`### ${badge} ${suiteName}`);
    lines.push('');
    lines.push('| Test | Status | Duration |');
    lines.push('|------|--------|----------|');
    for (const r of results) {
      const icon = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
      const duration = r.durationMs != null ? formatDuration(r.durationMs) : '-';
      const name = r.name.replace(/\|/g, '\\|');
      lines.push(`| ${name} | ${icon} ${r.status} | ${duration} |`);
    }
    lines.push('');
    const failedInSuite = results.filter((r) => r.status === 'failed');
    if (failedInSuite.length > 0) {
      lines.push('<details>');
      lines.push('<summary>Failure details</summary>');
      lines.push('');
      for (const r of failedInSuite) {
        lines.push(`- **${r.name}**`);
        lines.push(`  \`${(r.error || '').replace(/`/g, '\\`')}\``);
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, 'e2e-report.md'), lines.join('\n'));
}

/** Write JUnit-style XML for CI. */
function writeJunitXml(allResults, totalDurationMs) {
  const tests = allResults.length;
  const failures = allResults.filter((r) => r.status === 'failed').length;
  const escaped = (s) => {
    if (typeof s !== 'string') return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  let body = '';
  for (const r of allResults) {
    const time = (r.durationMs || 0) / 1000;
    if (r.status === 'failed') {
      body += `    <testcase name="${escaped(r.name)}" time="${time}"><failure message="${escaped(r.error || '')}"/></testcase>\n`;
    } else {
      body += `    <testcase name="${escaped(r.name)}" time="${time}"/>\n`;
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="e2e" time="${totalDurationMs / 1000}" tests="${tests}" failures="${failures}">
  <testsuite name="e2e" time="${totalDurationMs / 1000}" tests="${tests}" failures="${failures}">
${body}  </testsuite>
</testsuites>
`;
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, 'e2e-report.xml'), xml);
}

/** Load and run a suite by path (e.g. tests/Setup/setup.js). */
async function runSuite(suitePath) {
  const mod = await import(suitePath);
  if (typeof mod.run !== 'function') return [];
  return mod.run({ runOne });
}

async function main() {
  const startTime = now();
  const allResults = [];

  const suites = [
    join(E2E_DIR, 'tests', 'Health', 'health.js'),
    join(E2E_DIR, 'tests', 'Setup', 'setup.js'),
    join(E2E_DIR, 'tests', 'Auth', 'auth.js'),
    join(E2E_DIR, 'tests', 'Podcasts', 'podcasts.js'),
    join(E2E_DIR, 'tests', 'Episodes', 'episodes.js'),
    join(E2E_DIR, 'tests', 'Call', 'call.js'),
    join(E2E_DIR, 'tests', 'Public', 'public.js'),
    join(E2E_DIR, 'tests', 'Settings', 'settings.js'),
    join(E2E_DIR, 'tests', 'Users', 'users.js'),
    join(E2E_DIR, 'tests', 'Audio', 'audio.js'),
    join(E2E_DIR, 'tests', 'Library', 'library.js'),
    join(E2E_DIR, 'tests', 'Segments', 'segments.js'),
    join(E2E_DIR, 'tests', 'RSS', 'rss.js'),
    join(E2E_DIR, 'tests', 'Exports', 'exports.js'),
    join(E2E_DIR, 'tests', 'Sitemap', 'sitemap.js'),
    join(E2E_DIR, 'tests', 'Docs', 'docs.js'),
    join(E2E_DIR, 'tests', 'Contact', 'contact.js'),
    join(E2E_DIR, 'tests', 'Messages', 'messages.js'),
    join(E2E_DIR, 'tests', 'LLM', 'llm.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'subscriptions.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'collaboration.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'readonly-disabled.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'public-feed-episodes-audio.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'max-podcasts.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'max-episodes.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'max-storage.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'max-collaborators.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'max-subscriber-tokens.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'unlisted-sitemap.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'sitemap-cache.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'ban-bad-apikey.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'ban-bad-subscriber-token.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'ban-expired-apikey.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'ban-expired-subscriber-token.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'apikey-expiry.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'api-keys-and-tokens-validity.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'linking-domain.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'managed-domain.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'dns-domain-switch.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'dns-use-cname-a-record.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'show-cast-permissions.js'),
    join(E2E_DIR, 'tests', 'scenarios', 'show-cast-list.js'),
  ];

  console.log('E2E tests starting...\n');

  for (const suitePath of suites) {
    const parts = suitePath.split(/[/\\]/);
    const file = (parts.pop() || '').replace(/\.js$/, '');
    const parent = parts.pop() || '';
    const suiteName = parent === 'scenarios' ? `scenarios/${file}` : parent || suitePath;
    try {
      const results = await runSuite(suitePath);
      allResults.push(...results.map((r) => ({ ...r, suite: suiteName })));
      printSuiteProgress(suiteName, results);
    } catch (err) {
      console.log(`  ${suiteName}: ERROR ${err instanceof Error ? err.message : err}`);
      allResults.push({
        name: `${suiteName} (suite load)`,
        status: 'failed',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
        suite: suiteName,
      });
    }
  }

  const totalDurationMs = now() - startTime;
  const passed = allResults.filter((r) => r.status === 'passed').length;
  const failed = allResults.filter((r) => r.status === 'failed').length;
  const skipped = allResults.filter((r) => r.status === 'skipped').length;

  // Summary block
  console.log('\n' + '='.repeat(60));
  console.log(`  Total: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  console.log(`  Duration: ${formatDuration(totalDurationMs)}`);
  console.log(`  Status: ${failed > 0 ? 'FAIL' : 'PASS'}`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of allResults.filter((r) => r.status === 'failed')) {
      console.log(`  - ${r.name}`);
      console.log(`    ${r.error || ''}`);
    }
  }

  writeJsonReport(allResults, totalDurationMs);
  writeJunitXml(allResults, totalDurationMs);
  writeMarkdownReport(allResults, totalDurationMs);
  console.log(`\nReport written to ${REPORTS_DIR}/e2e-report.json, .xml, and .md\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
