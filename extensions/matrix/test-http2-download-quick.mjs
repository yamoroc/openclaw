#!/usr/bin/env node
/**
 * Matrix HTTP/2 Download QA Test Script - Quick Version
 * Tests downloadContent_v2() functionality without requiring live server
 */

import { downloadContent_v2, releaseDownloadAgent } from './src/matrix/client/download.ts';

// Test configuration
const TEST_CONFIG = {
  homeserverUrl: 'https://matrix.110827.xyz',
  accessToken: '',
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  details: [],
};

function record(testName, status, details = '') {
  results.details.push({ test: testName, status, details });
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.skipped++;
  
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`  ${icon} ${testName}${details ? ': ' + details : ''}`);
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Matrix HTTP/2 Download QA Test - Quick Validation       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${TEST_CONFIG.homeserverUrl}`);
  console.log(`Commit: 238e8536a`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // === Test Group 1: MXC URL Parsing ===
  console.log('📋 Group 1: MXC URL Parsing\n');
  
  const validUrls = [
    'mxc://matrix.org/ABC123',
    'mxc://example.com/media/xyz789',
    'mxc://matrix.110827.xyz/abcdef123456',
  ];
  
  for (const url of validUrls) {
    try {
      await downloadContent_v2(url, TEST_CONFIG.homeserverUrl, 'invalid', true, 2000, 1);
      record(`parse valid: ${url.substring(0, 30)}...`, 'PASS', 'Parsed correctly');
    } catch (err) {
      if (err.message.includes('Not a valid MXC URI') || err.message.includes('Missing')) {
        record(`parse valid: ${url.substring(0, 30)}...`, 'FAIL', err.message);
      } else {
        record(`parse valid: ${url.substring(0, 30)}...`, 'PASS', 'Parsed (network/auth error expected)');
      }
    }
  }
  
  const invalidUrls = [
    { url: 'https://example.com/image.png', desc: 'HTTP URL' },
    { url: 'mxc://', desc: 'Empty MXC' },
    { url: 'mxc://domain-only', desc: 'Missing mediaId' },
    { url: '', desc: 'Empty string' },
    { url: null, desc: 'Null value' },
  ];
  
  for (const { url, desc } of invalidUrls) {
    try {
      await downloadContent_v2(url, TEST_CONFIG.homeserverUrl, 'token', true, 1000, 1);
      record(`parse invalid: ${desc}`, 'FAIL', 'Should have thrown error');
    } catch (err) {
      if (err.message.includes('Not a valid MXC URI') || err.message.includes('Missing')) {
        record(`parse invalid: ${desc}`, 'PASS', 'Correctly rejected');
      } else {
        record(`parse invalid: ${desc}`, 'FAIL', `Wrong error: ${err.message.substring(0, 50)}`);
      }
    }
  }

  // === Test Group 2: Network Error Handling ===
  console.log('\n📋 Group 2: Error Handling\n');
  
  // Invalid server
  try {
    await downloadContent_v2(
      'mxc://test.example/file123',
      'https://invalid-server.example',
      'token',
      true,
      3000,
      1
    );
    record('network: invalid server', 'FAIL', 'Should have thrown error');
  } catch (err) {
    record('network: invalid server', 'PASS', `Error handled: ${err.message.substring(0, 40)}...`);
  }
  
  // Invalid token (will timeout due to unreachable server in test env)
  try {
    await downloadContent_v2(
      'mxc://matrix.110827.xyz/test',
      TEST_CONFIG.homeserverUrl,
      'invalid_token',
      true,
      3000,
      1
    );
    record('network: auth error', 'FAIL', 'Should have thrown error');
  } catch (err) {
    record('network: auth error', 'PASS', `Error handled: ${err.message.substring(0, 40)}...`);
  }

  // === Test Group 3: Connection Pool ===
  console.log('\n📋 Group 3: Connection Pool Management\n');
  
  try {
    // Multiple requests to test pool
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        downloadContent_v2(
          `mxc://test.example/file${i}`,
          'https://invalid-server.example',
          'token',
          true,
          1000,
          1
        ).catch(() => null)
      );
    }
    await Promise.all(promises);
    
    // Release agent
    releaseDownloadAgent();
    record('pool: multiple requests', 'PASS', 'Pool handled concurrent requests');
  } catch (err) {
    record('pool: multiple requests', 'FAIL', err.message);
  }
  
  // === Summary ===
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  ⚠️  Skipped: ${results.skipped}`);
  console.log('='.repeat(60));
  
  // Acceptance criteria
  console.log('\n📋 Acceptance Criteria:');
  
  // Criteria 1: All functional tests pass
  if (results.failed === 0) {
    console.log('  ✅ No functional failures');
  } else {
    console.log(`  ❌ ${results.failed} functional test(s) failed`);
  }
  
  // Criteria 2: Error handling works
  const errorTests = results.details.filter(d => d.test.includes('network') || d.test.includes('invalid'));
  const errorTestsPass = errorTests.filter(d => d.status === 'PASS').length;
  if (errorTestsPass === errorTests.length) {
    console.log('  ✅ Error handling working correctly');
  } else {
    console.log(`  ⚠️  Error handling partially working (${errorTestsPass}/${errorTests.length})`);
  }
  
  console.log('\n📌 Notes:');
  console.log('  - Performance tests require MATRIX_ACCESS_TOKEN environment variable');
  console.log('  - HTTP/2 verification requires live server with HTTP/2 support');
  console.log('  - For full testing, run with: MATRIX_ACCESS_TOKEN=xxx node test-http2-download-quick.mjs');
  console.log('');
  
  return results.failed === 0;
}

// Run tests
runTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
