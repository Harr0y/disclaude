---
name: improve-skill
description: Improve an existing skill by analyzing its structure, content, and adherence to best practices. Use when refining skills, enhancing descriptions, optimizing frontmatter configuration, or making skills more effective.
version: 1.0.0
argument-hint: [skill-name]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Improve Skill

A meta-skill for analyzing and improving other Claude Code skills.

## Overview

This skill improves an existing skill through a structured 3-phase process:
1. **Analyze** - Examine the skill's structure, content, and configuration
2. **Identify Issues** - Find areas for improvement based on best practices
3. **Apply Improvements** - Enhance the skill while preserving its core purpose

## Instructions

Analyzing and improving skill: **$ARGUMENTS**

Follow this 3-phase structured process:

### Phase 1: Analyze the Skill

Examine the target skill comprehensively:

1. **Locate and Read the Skill**
   - Search in project: `.claude/skills/$ARGUMENTS/SKILL.md`
   - Search in personal: `~/.claude/skills/$ARGUMENTS/SKILL.md`
   - Use `Glob` to find the skill location

2. **Analyze Frontmatter Configuration**
   - Check `name`: follows naming conventions (lowercase, hyphens, <64 chars)
   - Check `description`: is specific, includes keywords, describes use cases
   - Check `argument-hint`: properly formatted if applicable
   - Check `disable-model-invocation`: appropriate for skill type
   - Check `allowed-tools`: proper comma-separated format, tool names correct
   - Check `context`/`agent`: appropriate for skill's purpose

3. **Analyze Content Structure**
   - Identify skill type (Reference Content vs Task Content)
   - Check clarity of instructions
   - Verify step-by-step process is well-defined
   - Look for proper use of `$ARGUMENTS` variables
   - Check for examples and success criteria

### Phase 2: Identify Improvements

Compare against best practices and identify issues:

**Frontmatter Issues:**
- [ ] Description too vague or missing keywords
- [ ] Missing `disable-model-invocation` for task skills
- [ ] `allowed-tools` using wrong format (YAML array instead of comma-separated)
- [ ] Missing `argument-hint` for skills that take parameters
- [ ] Incorrect tool names in `allowed-tools`

**Content Issues:**
- [ ] Instructions unclear or ambiguous
- [ ] Missing examples or workflows
- [ ] No success criteria defined
- [ ] SKILL.md exceeds 500 lines (should use reference files)
- [ ] Lacking constraints or anti-patterns section

**Best Practice Violations:**
- [ ] Task skill without `disable-model-invocation: true`
- [ ] Reference skill with `disable-model-invocation: true`
- [ ] Fork context used for reference-only skills
- [ ] No `context`/`agent` for heavy exploration tasks

### Phase 3: Apply Improvements

Enhance the skill systematically:

1. **Propose Changes First**
   - Present a summary of planned improvements
   - Explain the rationale for each change
   - Highlight any breaking changes

2. **Apply Frontmatter Fixes**
   - Use `Edit` to fix frontmatter issues
   - Ensure proper YAML formatting
   - Verify tool names and syntax

3. **Enhance Content**
   - Clarify ambiguous instructions
   - Add missing examples or workflows
   - Improve structure and readability
   - Add success criteria if missing

4. **Create Supporting Files (if needed)**
   - Move detailed content to `reference.md`
   - Create `examples.md` for usage examples
   - Add `scripts/` directory if skill includes tools

## Reference Skill Best Practices

### Description Quality

**Good Description:**
```yaml
description: Explains code with visual diagrams and analogies. Use when explaining how code works, teaching about a codebase, or when the user asks "how does this work?"
```
- Specific keywords
- Clear use cases
- Trigger scenarios

**Poor Description:**
```yaml
description: Code explanation
description: This skill does X with Y and Z features...
```
- Too vague
- Or too verbose

### Skill Type Guidelines

| Type | Purpose | Recommended Settings |
|------|---------|---------------------|
| **Reference Content** | Inject knowledge (API specs, conventions) | No `disable-model-invocation` |
| **Task Content** | Execute operations (deploy, commit) | `disable-model-invocation: true` |
| **Interactive Task** | Needs user input | `argument-hint` + `$ARGUMENTS` |

### Allowed-Tools Format

**Correct:**
```yaml
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
```

**Incorrect:**
```yaml
allowed-tools: ["Read", "Write", "Edit"]  # Wrong format
tools: ["Read", "Write"]                  # Wrong field name
```

### Context and Agent Selection

| Scenario | Settings |
|----------|----------|
| Simple inline task | (no context setting) |
| Heavy codebase research | `context: fork` + `agent: Explore` |
| Architecture planning | `context: fork` + `agent: Plan` |
| General purpose | `context: fork` + `agent: general-purpose` |

## Common Improvements

### Fix Description

**Before:**
```yaml
description: A skill for deployment
```

**After:**
```yaml
description: Deploy application to production. Run tests, build, push to production, and verify health.
```

### Add Argument Hint

**Before:**
```yaml
name: fix-issue
description: Fix GitHub issue
```

**After:**
```yaml
name: fix-issue
description: Fix GitHub issue by analyzing requirements, implementing fix, and creating commit
argument-hint: [issue-number]
```

### Fix Allowed-Tools Format

**Before:**
```yaml
allowed-tools: ["Read", "Write", "Edit"]
```

**After:**
```yaml
allowed-tools: Read, Write, Edit
```

### Extract Reference Content

**Before (500+ line SKILL.md):**
```markdown
---
name: api-conventions
description: API conventions
---

# API Conventions

## Authentication
[20 lines of detailed auth docs...]

## Endpoints
[300 lines of endpoint documentation...]

## Errors
[50 lines of error codes...]
```

**After (SKILL.md + reference.md):**
```markdown
---
name: api-conventions
description: RESTful API conventions for this project. Use when creating or modifying API endpoints.
---

# API Conventions

## Quick Reference

- Authentication: Bearer token in Authorization header
- Base path: `/api/v1`
- Success response: `{ data: ... }`
- Error response: `{ error: string, code: number }`

## Detailed Documentation

See [reference.md](reference.md) for complete API specification.
```

## Success Criteria

A skill is successfully improved when:
- ✅ Frontmatter follows correct format and conventions
- ✅ Description is specific and includes use cases
- ✅ Instructions are clear and actionable
- ✅ Proper tool permissions configured
- ✅ Content is well-structured and readable
- ✅ Examples/workflows provided for complex skills
- ✅ SKILL.md under 500 lines (or content extracted)
- ✅ Skill type matches configuration

## Constraints

1. **Preserve Core Purpose** - Don't change what the skill does
2. **Maintain Backward Compatibility** - Keep existing behavior intact
3. **Read Before Editing** - Understand the skill's current state
4. **Explain Changes** - Provide rationale for modifications
5. **Test After Changes** - Verify skill still works as expected

## Analysis Template

When analyzing a skill, use this template:

```
## Skill Analysis: [skill-name]

### Location
- Path: [skill path]

### Frontmatter Review
- name: [check format]
- description: [check quality]
- argument-hint: [present if needed]
- disable-model-invocation: [appropriate for type?]
- allowed-tools: [correct format?]
- context/agent: [appropriate for workload?]

### Content Review
- Skill Type: [Reference / Task / Interactive]
- Structure Quality: [Good / Fair / Poor]
- Clarity of Instructions: [score 1-5]
- Examples Present: [Yes / No]
- Success Criteria: [Yes / No]
- Line Count: [number]

### Issues Found
1. [Critical issues]
2. [Important issues]
3. [Nice to have]

### Proposed Improvements
1. [Specific changes with rationale]
2. [Specific changes with rationale]
```

## Example Workflow

**Input**: `/improve-skill deploy`

**Phase 1:**
```
Located: .claude/skills/deploy/SKILL.md
Current frontmatter:
- name: deploy ✓
- description: "Deploy app" ✗ (too vague)
- allowed-tools: ["Bash"] ✗ (wrong format)
- Missing: disable-model-invocation
```

**Phase 2:**
```
Issues:
1. Description lacks keywords and use cases
2. allowed-tools uses YAML array instead of comma-separated
3. Missing disable-model-invocation (task skill should have it)
4. No verification step mentioned
```

**Phase 3:**
```
Applied:
1. Updated description to "Build, test, and deploy application to production environment with health verification"
2. Changed allowed-tools to "Bash, Read"
3. Added disable-model-invocation: true
4. Added post-deployment verification step
```

## Notes

- This is a meta-skill - it improves other skills
- Always read the full skill before making changes
- Focus on making skills more discoverable and effective
- Preserve the original skill's intent and functionality
- Reference: [reference.md](reference.md)
