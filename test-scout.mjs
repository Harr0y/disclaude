#!/usr/bin/env node
/**
 * Test script for Scout agent with skill activation.
 *
 * This script tests:
 * 1. Skills are copied to workspace/.claude/skills
 * 2. Scout agent can initialize and query
 * 3. Skill activation command works correctly
 */

import { Scout } from './dist/index.js';
import { Config } from './dist/index.js';
import { setupSkillsInWorkspace, verifySkillsSetup } from './dist/index.js';

async function testScout() {
  console.log('='.repeat(60));
  console.log(' Scout Agent Skill Activation Test');
  console.log('='.repeat(60));
  console.log();

  // Step 1: Setup skills
  console.log('📦 Step 1: Setting up skills in workspace...');
  const setupResult = await setupSkillsInWorkspace();
  if (setupResult.success) {
    console.log('✅ Skills copied successfully');
  } else {
    console.log('❌ Failed to copy skills:', setupResult.error);
    process.exit(1);
  }
  console.log();

  // Step 2: Verify skills
  console.log('🔍 Step 2: Verifying skills setup...');
  const isSetup = await verifySkillsSetup();
  if (isSetup) {
    console.log('✅ Skills verified in workspace/.claude/skills');
  } else {
    console.log('❌ Skills not found in workspace');
    process.exit(1);
  }
  console.log();

  // Step 3: Initialize Scout
  console.log('🤖 Step 3: Initializing Scout agent...');
  const agentConfig = Config.getAgentConfig();
  const scout = new Scout({
    apiKey: agentConfig.apiKey,
    model: agentConfig.model,
    apiBaseUrl: agentConfig.apiBaseUrl,
    skillName: 'scout',
  });

  await scout.initialize();
  console.log('✅ Scout initialized');
  console.log();

  // Step 4: Set task context
  console.log('📋 Step 4: Setting task context...');
  scout.setTaskContext({
    chatId: 'test-chat-123',
    messageId: 'test-msg-456',
    taskPath: '/tmp/test-task.md',
  });
  console.log('✅ Task context set');
  console.log();

  // Step 5: Query Scout
  console.log('💬 Step 5: Sending test query...');
  console.log('   Query: "List all TypeScript files in src/"');
  console.log();

  const testPrompt = 'List all TypeScript files in src/';
  let responseCount = 0;
  let skillActivated = false;

  try {
    for await (const message of scout.queryStream(testPrompt)) {
      responseCount++;
      const content = message.content;

      // Check for skill activation
      if (content.includes('/skill:scout')) {
        skillActivated = true;
        console.log('✅ Skill activation command detected in prompt');
      }

      // Print message
      if (content && content.trim()) {
        const type = message.messageType || 'text';
        console.log(`[${type}] ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
      }

      // Break after a few responses for testing
      if (responseCount >= 5) {
        console.log('\\n⏸️  Test stopped after 5 responses (this is intentional)');
        break;
      }
    }
  } catch (error) {
    console.error('❌ Error during query:', error.message);
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(60));
  console.log(' Test Results');
  console.log('='.repeat(60));
  console.log(`✅ Skills setup: ${setupResult.success ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Skills verified: ${isSetup ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Scout initialized: PASS`);
  console.log(`✅ Query executed: ${responseCount > 0 ? 'PASS' : 'FAIL'} (${responseCount} messages)`);
  console.log(`✅ Skill activated: ${skillActivated ? 'PASS' : 'FAIL (check logs)'}`);
  console.log('='.repeat(60));
  console.log();
  console.log('🎉 All tests completed!');

  // Cleanup
  scout.cleanup();
}

// Run test
testScout().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
