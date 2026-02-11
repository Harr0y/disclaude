import { parseTaskMd } from './dist/task/file-manager.js';

const testTaskMd = `# Task: Test Task

**Task ID**: om_test123
**Created**: 2024-02-10T12:00:00Z
**Chat ID**: oc_test456
**User ID**: ou_user789

## Original Request

\`\`\`
Test request for parsing
\`\`\`

## Expected Results

Test expected results`;

const result = parseTaskMd(testTaskMd);
console.log('✅ parseTaskMd test result:');
console.log(JSON.stringify(result, null, 2));

// Verify results
if (result.messageId === 'om_test123' && 
    result.chatId === 'oc_test456' && 
    result.userId === 'ou_user789' &&
    result.userRequest === 'Test request for parsing') {
  console.log('\n✅ All assertions passed!');
  process.exit(0);
} else {
  console.error('\n❌ Test failed!');
  process.exit(1);
}
