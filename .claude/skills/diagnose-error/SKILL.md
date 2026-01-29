---
name: diagnose-error
description: Diagnose errors by analyzing PM2 logs, stack traces, and error patterns. Use when debugging production issues, investigating failures, or troubleshooting errors.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob
---

# Diagnose Error Skill

Automated error diagnosis through log analysis and pattern matching. This skill focuses on extracting and analyzing the latest errors from PM2 logs to identify root causes quickly.

## When to Use This Skill

Use this skill when:
- Debugging production errors in PM2-managed services
- Investigating recent failures or crashes
- Troubleshooting after deployment
- Analyzing error patterns in logs
- User reports "something isn't working"

## Default Behavior

By default, this skill:
1. Fetches the latest PM2 error logs
2. Extracts the most recent error with full stack trace
3. Analyzes error patterns and identifies root causes
4. Provides actionable next steps

---

## Step 1: Fetch Latest Error Logs

**Goal**: Get the most recent error information from PM2.

### Default Command

```bash
# Get latest error logs (default 100 lines)
pm2 logs --err --lines 100 --nostream
```

### Options

- **More lines**: Increase `--lines` for deeper history
- **Specific app**: Add app name like `pm2 logs disclaude-feishu --err --lines 200`
- **Timestamp search**: Use `--timestamp` to see when errors occurred

### Alternative Log Sources

If PM2 is not available:
```bash
# Application logs
tail -n 100 logs/app-error.log

# Docker logs
docker logs <container> --tail 100

# Systemd logs
journalctl -u <service> -n 100 --no-pager
```

---

## Step 2: Extract Error Context

**Goal**: Parse the error to understand what happened.

### Identify Key Information

1. **Error Type**
   - JavaScript/TypeScript errors (TypeError, ReferenceError, etc.)
   - HTTP errors (4xx, 5xx)
   - Network/connection errors
   - MCP/SDK errors

2. **Stack Trace**
   - Which file/function threw the error?
   - What was the call chain?
   - Is it a nested error (caused by)?

3. **Error Message**
   - What is the specific error?
   - Are there any relevant error codes?

4. **Context**
   - Timestamp
   - Request/message being processed
   - Environment variables if shown

### Common Error Patterns

**Pattern: Type Errors**
```
TypeError: Cannot read property 'x' of undefined
→ Likely cause: Null/undefined access, missing validation
```

**Pattern: Network Errors**
```
ECONNREFUSED / ETIMEDOUT
→ Likely cause: Service unavailable, wrong endpoint, network issue
```

**Pattern: MCP/SDK Errors**
```
MCP tool 'xxx' not found
→ Likely cause: Tool not configured, wrong name in allowed-tools
```

---

## Step 3: Root Cause Analysis

**Goal**: Determine why the error occurred.

### Analysis Checklist

- [ ] **Code Issue**: Bug in recent changes?
- [ ] **Configuration**: Wrong env var or config?
- [ ] **External Dependency**: API/service down?
- [ ] **Resource Issue**: Out of memory, disk space?
- [ ] **Race Condition**: Timing-related issue?

### Diagnostic Commands

```bash
# Check recent changes
git diff HEAD~1 --stat

# Check environment
env | grep -E 'API|DATABASE|REDIS'

# Check disk space
df -h

# Check memory
free -h  # Linux
vm_stat  # macOS

# Check service status
pm2 status
pm2 info <app-name>
```

---

## Step 4: Provide Diagnosis

**Goal**: Present findings and recommendations.

### Output Format

```
## Error Diagnosis

### Error Summary
- **Type**: [Error type]
- **Location**: [file:line]
- **Time**: [timestamp if available]

### Root Cause
[Explanation of why the error occurred]

### Stack Trace
```
[Relevant stack trace lines]
```

### Likely Fix
[Specific action to fix]

### Next Steps
1. [Immediate action]
2. [Verification step]
3. [Prevention measure]
```

---

## Common Error Diagnoses

### Feishu Bot Errors

**WebSocket Disconnection**
```
Error: WebSocket connection closed
→ Check network, verify Feishu service status
→ May need reconnection logic
```

**Message Processing Error**
```
Error in handleMessageReceive
→ Check message format, validation
→ May be new message type from Feishu
```

**MCP Tool Not Found**
```
Tool 'send_file_to_feishu' not found in allowed-tools
→ Add tool to allowed-tools list
→ Check tool name spelling
```

### File System Errors

**ENOENT: No such file or directory**
```
→ Check if file/path exists
→ Verify working directory (WORKSPACE_DIR)
→ Check file permissions
```

**EACCES: Permission denied**
```
→ Check file permissions (chmod/chown)
→ Verify user running the process
```

### Network Errors

**ECONNREFUSED**
```
→ Target service not running
→ Wrong host/port
→ Firewall blocking
```

**ETIMEDOUT**
```
→ Network latency
→ Service slow to respond
→ Timeout value too low
```

---

## Quick Diagnosis Commands

```bash
# Quick error overview
pm2 logs --err --lines 50 --nostream | tail -30

# Find specific error pattern
pm2 logs --err --nostream | grep -i "TypeError"

# Get full error with context
pm2 logs --err --lines 200 --nostream | grep -A 20 "Error:"

# Check service health
pm2 status
pm2 describe <app-name>
```

---

## Example Workflow

**User says**: "The bot isn't working"

### Step 1: Fetch Logs
```bash
pm2 logs disclaude-feishu --err --lines 100 --nostream
```

### Step 2: Extract Error
Found:
```
TypeError: Cannot read properties of undefined (reading 'sender_id')
    at FeishuBot.handleMessageReceive (src/feishu/bot.ts:123:45)
```

### Step 3: Analyze
- Error: Null access on `event.sender`
- Location: `src/feishu/bot.ts:123`
- Pattern: Missing null check

### Step 4: Diagnose
```
## Error Diagnosis

### Root Cause
The message event doesn't have a `sender` property, causing null access.

### Likely Fix
Add null check before accessing `event.sender.sender_id`

### Next Steps
1. Read src/feishu/bot.ts around line 123
2. Add validation: `if (!event.sender) return;`
3. Test with various message types
```

---

## Anti-Patterns to Avoid

### ❌ Guess Without Evidence
```
"Probably a network issue..."
```
**Problem**: Wastes time on wrong fix

**Correct approach**:
```
"Let me check the logs first..."
```

### ❌ Ignore Stack Trace
```
"Something went wrong, let me restart"
```
**Problem**: Doesn't solve root cause

**Correct approach**:
```
"Error at line 123 in bot.ts, let me examine..."
```

### ❌ Over-Scan Logs
```
# Reading 10,000 lines of logs
pm2 logs --lines 10000
```
**Problem**: Too much noise, slow

**Correct approach**:
```
# Start with recent errors
pm2 logs --err --lines 100
# Expand if needed
```

---

## Success Criteria

Diagnosis is complete when:
- ✅ Latest error extracted from logs
- ✅ Root cause identified
- ✅ Specific location pinpointed (file:line)
- ✅ Actionable fix recommendation provided
- ✅ Next steps clearly defined
