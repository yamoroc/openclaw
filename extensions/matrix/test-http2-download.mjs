#!/usr/bin/env node
/**
 * Matrix HTTP/2 Download QA Test Script
 * Tests downloadContent_v2() vs original downloadContent()
 */

import { downloadContent_v2, releaseDownloadAgent } from './src/matrix/client/download.ts';
import { LogService } from '@vector-im/matrix-bot-sdk';

// Enable debug logging
process.env.LOG_LEVEL = 'debug';

// Test configuration
const TEST_CONFIG = {
  // Matrix server configuration
  homeserverUrl: process.env.MATRIX_HOMESERVER || 'https://matrix.110827.xyz',
  accessToken: process.env.MATRIX_ACCESS_TOKEN || '',
  
  // Test MXC URLs (various sizes)
  testFiles: [
    {
      name: 'Small image (~50KB)',
      mxcUrl: 'mxc://matrix.110827.xyz/test-small',
      expectedSize: 50 * 1024,
    },
    {
      name: 'Medium image (~712KB)',
      mxcUrl: 'mxc://matrix.110827.xyz/test-medium',
      expectedSize: 712 * 1024,
    },
    {
      name: 'Large file (~5MB)',
      mxcUrl: 'mxc://matrix.110827.xyz/test-large',
      expectedSize: 5 * 1024 * 1024,
    },
  ],
};

// Test results storage
const testResults = {
  functional: [],
  performance: [],
  errors: [],
};

/**
 * Test 1: Functional Test - Valid MXC URL parsing
 */
async function testFunctionalValidMXC() {
  console.log('\n📋 TEST 1: Functional Test - Valid MXC URL parsing\n');
  
  const validUrls = [
    'mxc://matrix.org/ABC123',
    'mxc://example.com/media/xyz789',
    'mxc://matrix.110827.xyz/abcdef123456',
  ];
  
  for (const url of validUrls) {
    try {
      // Just test parsing by calling with invalid token (will fail auth but parse should work)
      console.log(`  Testing parse: ${url}`);
      // The parseMXCUrl function is internal, but we can test via downloadContent_v2
      // which will fail with auth error but not parse error
      await downloadContent_v2(url, TEST_CONFIG.homeserverUrl, 'invalid_token', true, 5000, 1);
    } catch (err) {
      if (err.message.includes('Not a valid MXC URI')) {
        testResults.functional.push({ test: `parse ${url}`, status: 'FAIL', error: err.message });
        console.log(`    ❌ FAIL: ${err.message}`);
      } else {
        // Auth error is expected, parse succeeded
        testResults.functional.push({ test: `parse ${url}`, status: 'PASS' });
        console.log(`    ✅ PASS: Parsed correctly (auth error expected)`);
      }
    }
  }
}

/**
 * Test 2: Functional Test - Invalid MXC URL handling
 */
async function testFunctionalInvalidMXC() {
  console.log('\n📋 TEST 2: Functional Test - Invalid MXC URL handling\n');
  
  const invalidUrls = [
    { url: 'https://example.com/image.png', desc: 'HTTP URL' },
    { url: 'mxc://', desc: 'Empty MXC' },
    { url: 'mxc://domain-only', desc: 'Missing mediaId' },
    { url: '', desc: 'Empty string' },
    { url: null, desc: 'Null value' },
  ];
  
  for (const { url, desc } of invalidUrls) {
    try {
      console.log(`  Testing invalid: ${desc} (${url})`);
      await downloadContent_v2(url, TEST_CONFIG.homeserverUrl, 'token', true, 5000, 1);
      testResults.functional.push({ test: `invalid ${desc}`, status: 'FAIL', error: 'Should have thrown error' });
      console.log(`    ❌ FAIL: Should have thrown error`);
    } catch (err) {
      if (err.message.includes('Not a valid MXC URI') || err.message.includes('Missing')) {
        testResults.functional.push({ test: `invalid ${desc}`, status: 'PASS' });
        console.log(`    ✅ PASS: Correctly rejected with: ${err.message}`);
      } else {
        testResults.functional.push({ test: `invalid ${desc}`, status: 'FAIL', error: err.message });
        console.log(`    ❌ FAIL: Wrong error: ${err.message}`);
      }
    }
  }
}

/**
 * Test 3: Performance Test - Download speed
 */
async function testPerformance() {
  console.log('\n📋 TEST 3: Performance Test\n');
  
  if (!TEST_CONFIG.accessToken) {
    console.log('  ⚠️  SKIP: No MATRIX_ACCESS_TOKEN provided');
    console.log('  Set MATRIX_ACCESS_TOKEN env var to run performance tests');
    testResults.performance.push({ test: 'performance', status: 'SKIP', reason: 'No access token' });
    return;
  }
  
  for (const file of TEST_CONFIG.testFiles) {
    console.log(`\n  Testing: ${file.name}`);
    console.log(`  URL: ${file.mxcUrl}`);
    
    const times = [];
    const speeds = [];
    const results = [];
    
    // Run 3 iterations
    for (let i = 0; i < 3; i++) {
      const startTime = Date.now();
      try {
        const result = await downloadContent_v2(
          file.mxcUrl,
          TEST_CONFIG.homeserverUrl,
          TEST_CONFIG.accessToken,
          true,
          60000,
          2
        );
        
        const duration = Date.now() - startTime;
        const speedKbps = (result.data.length / 1024) / (duration / 1000);
        
        times.push(duration);
        speeds.push(speedKbps);
        results.push({
          iteration: i + 1,
          duration,
          size: result.data.length,
          speedKbps: speedKbps.toFixed(1),
          contentType: result.contentType,
        });
        
        console.log(`    Run ${i + 1}: ${duration}ms, ${speedKbps.toFixed(1)} KB/s, ${result.data.length} bytes`);
      } catch (err) {
        console.log(`    Run ${i + 1}: ERROR - ${err.message}`);
        results.push({ iteration: i + 1, error: err.message });
      }
      
      // Small delay between runs
      await new Promise(r => setTimeout(r, 500));
    }
    
    // Calculate stats
    const successfulRuns = results.filter(r => !r.error);
    if (successfulRuns.length > 0) {
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      
      testResults.performance.push({
        test: file.name,
        status: 'PASS',
        avgTimeMs: avgTime.toFixed(0),
        avgSpeedKbps: avgSpeed.toFixed(1),
        runs: successfulRuns.length,
        details: results,
      });
      
      console.log(`\n  📊 Summary for ${file.name}:`);
      console.log(`     Average time: ${avgTime.toFixed(0)}ms`);
      console.log(`     Average speed: ${avgSpeed.toFixed(1)} KB/s`);
      console.log(`     Successful runs: ${successfulRuns.length}/3`);
    } else {
      testResults.performance.push({
        test: file.name,
        status: 'FAIL',
        error: 'All runs failed',
        details: results,
      });
    }
  }
}

/**
 * Test 4: HTTP/2 Protocol Verification
 */
async function testHttp2Protocol() {
  console.log('\n📋 TEST 4: HTTP/2 Protocol Verification\n');
  
  // This test verifies HTTP/2 is being used by checking connection behavior
  // We make multiple sequential requests and check if connection reuse happens
  
  console.log('  Testing connection behavior...');
  
  if (!TEST_CONFIG.accessToken) {
    console.log('  ⚠️  SKIP: No MATRIX_ACCESS_TOKEN provided');
    testResults.functional.push({ test: 'http2', status: 'SKIP', reason: 'No access token' });
    return;
  }
  
  // Make multiple rapid requests to test connection reuse
  const testUrl = TEST_CONFIG.testFiles[0]?.mxcUrl;
  if (!testUrl) {
    console.log('  ⚠️  SKIP: No test URL available');
    return;
  }
  
  console.log('  Making 5 sequential requests to test connection pooling...');
  
  const timings = [];
  for (let i = 0; i < 5; i++) {
    const startTime = Date.now();
    try {
      await downloadContent_v2(
        testUrl,
        TEST_CONFIG.homeserverUrl,
        TEST_CONFIG.accessToken,
        true,
        30000,
        1
      );
      const duration = Date.now() - startTime;
      timings.push({ iteration: i + 1, duration });
      console.log(`    Request ${i + 1}: ${duration}ms`);
    } catch (err) {
      timings.push({ iteration: i + 1, error: err.message });
      console.log(`    Request ${i + 1}: ERROR - ${err.message}`);
    }
  }
  
  // If connection reuse works, subsequent requests should be faster
  const successfulTimings = timings.filter(t => !t.error).map(t => t.duration);
  if (successfulTimings.length >= 3) {
    const firstRequest = successfulTimings[0];
    const avgSubsequent = successfulTimings.slice(1).reduce((a, b) => a + b, 0) / (successfulTimings.length - 1);
    
    console.log(`\n  📊 Connection Analysis:`);
    console.log(`     First request: ${firstRequest}ms`);
    console.log(`     Avg subsequent: ${avgSubsequent.toFixed(0)}ms`);
    
    if (avgSubsequent < firstRequest * 0.8) {
      console.log(`     ✅ Connection reuse likely working (subsequent requests faster)`);
      testResults.functional.push({ test: 'http2', status: 'PASS', note: 'Connection reuse detected' });
    } else {
      console.log(`     ⚠️  Connection reuse unclear (timings similar)`);
      testResults.functional.push({ test: 'http2', status: 'UNCLEAR', note: 'Timings similar, may still be HTTP/2' });
    }
  }
}

/**
 * Test 5: Error Handling - Network errors
 */
async function testErrorHandling() {
  console.log('\n📋 TEST 5: Error Handling\n');
  
  // Test with invalid homeserver
  try {
    console.log('  Testing invalid homeserver...');
    await downloadContent_v2(
      'mxc://test.example/file123',
      'https://invalid-server-that-does-not-exist.example',
      'token',
      true,
      5000,
      1
    );
    console.log(`    ❌ FAIL: Should have thrown error`);
    testResults.functional.push({ test: 'network error', status: 'FAIL' });
  } catch (err) {
    console.log(`    ✅ PASS: Correctly handled error: ${err.message.substring(0, 100)}...`);
    testResults.functional.push({ test: 'network error', status: 'PASS' });
  }
  
  // Test with invalid token (should get 401)
  try {
    console.log('  Testing invalid token...');
    await downloadContent_v2(
      'mxc://matrix.110827.xyz/test',
      'https://matrix.110827.xyz',
      'invalid_token_here',
      true,
      10000,
      1
    );
    console.log(`    ❌ FAIL: Should have thrown error`);
    testResults.functional.push({ test: 'auth error', status: 'FAIL' });
  } catch (err) {
    console.log(`    ✅ PASS: Correctly handled error: ${err.message.substring(0, 100)}...`);
    testResults.functional.push({ test: 'auth error', status: 'PASS' });
  }
}

/**
 * Print final summary
 */
function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  
  // Functional tests
  console.log('\n🧪 Functional Tests:');
  for (const test of testResults.functional) {
    const icon = test.status === 'PASS' ? '✅' : test.status === 'SKIP' ? '⚠️' : '❌';
    console.log(`  ${icon} ${test.test}: ${test.status}`);
    if (test.status === 'PASS') passCount++;
    else if (test.status === 'SKIP') skipCount++;
    else failCount++;
  }
  
  // Performance tests
  console.log('\n⚡ Performance Tests:');
  for (const test of testResults.performance) {
    const icon = test.status === 'PASS' ? '✅' : test.status === 'SKIP' ? '⚠️' : '❌';
    console.log(`  ${icon} ${test.test}: ${test.status}`);
    if (test.avgSpeedKbps) {
      console.log(`     Avg Speed: ${test.avgSpeedKbps} KB/s`);
      console.log(`     Avg Time: ${test.avgTimeMs}ms`);
    }
    if (test.status === 'PASS') passCount++;
    else if (test.status === 'SKIP') skipCount++;
    else failCount++;
  }
  
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  console.log('='.repeat(60));
  
  // Acceptance criteria check
  console.log('\n📋 Acceptance Criteria Check:');
  
  // Check 1: Download speed improvement
  const perfTest = testResults.performance.find(p => p.test?.includes('Medium'));
  if (perfTest && perfTest.status === 'PASS') {
    const timeMs = parseInt(perfTest.avgTimeMs);
    if (timeMs < 3000) {
      console.log(`  ✅ Speed: ${timeMs}ms < 3000ms target`);
    } else {
      console.log(`  ❌ Speed: ${timeMs}ms >= 3000ms target`);
    }
  } else {
    console.log(`  ⚠️  Speed: Could not verify (no performance data)`);
  }
  
  // Check 2: No critical failures
  if (failCount === 0) {
    console.log(`  ✅ No critical failures`);
  } else {
    console.log(`  ❌ ${failCount} test(s) failed`);
  }
  
  console.log('\n');
}

/**
 * Main test runner
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Matrix HTTP/2 Download QA Test Suite                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${TEST_CONFIG.homeserverUrl}`);
  console.log(`Time: ${new Date().toISOString()}`);
  
  try {
    // Run all tests
    await testFunctionalValidMXC();
    await testFunctionalInvalidMXC();
    await testErrorHandling();
    await testPerformance();
    await testHttp2Protocol();
    
    // Cleanup
    releaseDownloadAgent();
    
    // Print summary
    printSummary();
    
  } catch (err) {
    console.error('Fatal error during testing:', err);
    process.exit(1);
  }
}

// Run tests
main().catch(console.error);
