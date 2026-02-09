/**
 * Comprehensive tests for TaskPlanner class.
 * Tests task planning logic, iteration management, scout orchestration, and decision-making processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskPlanner } from './planner.js';
import type { LongTaskPlan } from './types.js';
import * as sdkUtils from '../utils/sdk.js';

// Mock dependencies
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('../utils/sdk.js', () => ({
  parseSDKMessage: vi.fn((message) => ({
    content: message.content || '',
    metadata: message.metadata || {},
  })),
  buildSdkEnv: vi.fn((apiKey, apiBaseUrl) => ({
    ANTHROPIC_API_KEY: apiKey,
    ...(apiBaseUrl && { ANTHROPIC_API_BASE_URL: apiBaseUrl }),
  })),
  getNodeBinDir: vi.fn(() => '/usr/bin'),
}));

vi.mock('../config/index.js', () => ({
  Config: {
    getWorkspaceDir: vi.fn(() => '/test/workspace'),
  },
}));

vi.mock('../task/skill-loader.js', () => ({
  loadSkill: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadSkill } from '../task/skill-loader.js';

describe('TaskPlanner', () => {
  let planner: TaskPlanner;
  let apiKey: string;
  let model: string;
  let apiBaseUrl: string | undefined;

  beforeEach(() => {
    apiKey = 'test-api-key';
    model = 'claude-3-5-sonnet-20241022';
    apiBaseUrl = undefined;
    planner = new TaskPlanner(apiKey, model, apiBaseUrl);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create planner with API key and model', () => {
      expect(planner).toBeInstanceOf(TaskPlanner);
      expect(planner['apiKey']).toBe(apiKey);
      expect(planner['model']).toBe(model);
    });

    it('should store API base URL if provided', () => {
      const customBaseUrl = 'https://custom.api.url';
      const plannerWithBaseUrl = new TaskPlanner(apiKey, model, customBaseUrl);
      expect(plannerWithBaseUrl['apiBaseUrl']).toBe(customBaseUrl);
    });

    it('should initialize as not initialized', () => {
      expect(planner['initialized']).toBe(false);
    });

    it('should have no skill loaded initially', () => {
      expect(planner['skill']).toBeUndefined();
    });

    it('should set working directory from config', () => {
      expect(planner['workingDirectory']).toBe('/test/workspace');
    });
  });

  describe('initialize()', () => {
    it('should load planner skill successfully', async () => {
      const mockSkill = {
        name: 'planner',
        content: 'Custom planner instructions',
        allowedTools: ['Read', 'Glob', 'Grep'],
      };
      vi.mocked(loadSkill).mockResolvedValue({
        success: true,
        skill: mockSkill,
      });

      await planner.initialize();

      expect(planner['skill']).toEqual(mockSkill);
      expect(planner['initialized']).toBe(true);
    });

    it('should handle missing skill gracefully', async () => {
      vi.mocked(loadSkill).mockResolvedValue({
        success: false,
        error: 'Skill file not found',
      });

      await planner.initialize();

      expect(planner['skill']).toBeUndefined();
      expect(planner['initialized']).toBe(true);
    });

    it('should not initialize twice', async () => {
      const mockSkill = {
        name: 'planner',
        content: 'Custom instructions',
        allowedTools: ['Read'],
      };
      vi.mocked(loadSkill).mockResolvedValue({
        success: true,
        skill: mockSkill,
      });

      await planner.initialize();
      await planner.initialize();

      expect(loadSkill).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent', async () => {
      vi.mocked(loadSkill).mockResolvedValue({
        success: false,
        error: 'Not found',
      });

      await planner.initialize();
      const firstCallInitialized = planner['initialized'];

      await planner.initialize();
      const secondCallInitialized = planner['initialized'];

      expect(firstCallInitialized).toBe(true);
      expect(secondCallInitialized).toBe(true);
    });
  });

  describe('generateTaskId()', () => {
    it('should generate unique task IDs', () => {
      const id1 = planner['generateTaskId']();
      const id2 = planner['generateTaskId']();

      expect(id1).not.toBe(id2);
    });

    it('should follow correct format', () => {
      const taskId = planner['generateTaskId']();
      expect(taskId).toMatch(/^long-task-\d+-[a-z0-9]{6}$/);
    });

    it('should include timestamp component', () => {
      const beforeTime = Date.now();
      const taskId = planner['generateTaskId']();
      const afterTime = Date.now();

      const timestampStr = taskId.match(/^long-task-(\d+)-/)?.[1];
      expect(timestampStr).toBeDefined();

      const timestamp = parseInt(timestampStr!, 10);
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should include random component for uniqueness at same timestamp', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(planner['generateTaskId']());
      }
      expect(ids.size).toBeGreaterThan(1);
    });

    it('should generate 6-character random component', () => {
      const taskId = planner['generateTaskId']();
      const parts = taskId.split('-');
      // Task ID format is long-task-{timestamp}-{random}
      // The random part should be the last part and be 6 chars
      const randomPart = parts[parts.length - 1];
      expect(randomPart).toHaveLength(6);
    });
  });

  describe('createPlanningPrompt()', () => {
    it('should use skill-based prompt when skill is loaded', async () => {
      const customPrompt = 'Custom planning instructions';
      vi.mocked(loadSkill).mockResolvedValue({
        success: true,
        skill: {
          name: 'planner',
          content: customPrompt,
          allowedTools: ['Read'],
        },
      });

      await planner.initialize();
      const prompt = planner['createPlanningPrompt']('Test request');

      expect(prompt).toContain(customPrompt);
      expect(prompt).toContain('Test request');
    });

    it('should use fallback prompt when skill is not loaded', async () => {
      vi.mocked(loadSkill).mockResolvedValue({
        success: false,
        error: 'Not found',
      });

      await planner.initialize();
      const prompt = planner['createPlanningPrompt']('Test request');

      expect(prompt).toContain('task planning expert');
      expect(prompt).toContain('Test request');
    });

    it('should include user request in prompt', () => {
      const userRequest = 'Build a web application';
      const prompt = planner['createPlanningPrompt'](userRequest);

      expect(prompt).toContain(userRequest);
    });

    it('should specify JSON response format in fallback', () => {
      const prompt = planner['createPlanningPrompt']('Test');
      expect(prompt).toContain('JSON');
    });

    it('should include subtask structure requirements', () => {
      const prompt = planner['createPlanningPrompt']('Test');
      expect(prompt).toContain('subtasks');
      expect(prompt).toContain('sequence');
      expect(prompt).toContain('inputs');
      expect(prompt).toContain('outputs');
    });

    it('should include markdown requirements specification', () => {
      const prompt = planner['createPlanningPrompt']('Test');
      expect(prompt).toContain('markdownRequirements');
      expect(prompt).toContain('summaryFile');
    });

    it('should mention inter-step dependencies', () => {
      const prompt = planner['createPlanningPrompt']('Test');
      expect(prompt).toContain('Inter-Step Dependencies');
      expect(prompt).toContain('#');
    });
  });

  describe('extractPlanFromResponse()', () => {
    it('should extract clean JSON from response', () => {
      const response = '{"title":"Test","subtasks":[]}';
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });

    it('should extract JSON from markdown code block', () => {
      const response = '```json\n{"title":"Test","subtasks":[]}\n```';
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });

    it('should extract JSON from code block without language tag', () => {
      const response = '```\n{"title":"Test","subtasks":[]}\n```';
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });

    it('should handle JSON with explanatory text before', () => {
      const response = 'Here is the plan:\n{"title":"Test","subtasks":[]}';
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });

    it('should handle JSON with explanatory text after', () => {
      const response = '{"title":"Test","subtasks":[]}\n\nThis plan looks good.';
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });

    it('should find JSON boundaries in mixed content', () => {
      const response = 'Some text\n{"title":"Test","subtasks":[]}\nMore text';
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });

    it('should throw on malformed JSON', () => {
      const response = '{"title":"Test", invalid}';

      expect(() => {
        planner['extractPlanFromResponse'](response);
      }).toThrow('Failed to parse plan JSON');
    });

    it('should include extracted content in error message', () => {
      const response = '```json\n{broken json}\n```';

      expect(() => {
        planner['extractPlanFromResponse'](response);
      }).toThrow(/\n\nExtracted content:\n/);
    });

    it('should handle nested JSON structures', () => {
      const response = JSON.stringify({
        title: 'Complex Task',
        subtasks: [
          {
            sequence: 1,
            title: 'Step 1',
            inputs: { context: { nested: { value: 1 } } },
            outputs: { markdownRequirements: [{ id: 'test', title: 'Test', content: 'Content', required: true }] },
          },
        ],
      });
      const result = planner['extractPlanFromResponse'](response);

      expect(result.subtasks[0].inputs.context.nested.value).toBe(1);
    });

    it('should handle whitespace in JSON', () => {
      const response = `
        {
          "title": "Test",
          "subtasks": []
        }
      `;
      const result = planner['extractPlanFromResponse'](response);

      expect(result).toEqual({ title: 'Test', subtasks: [] });
    });
  });

  describe('validatePlan()', () => {
    let validPlan: LongTaskPlan;

    beforeEach(() => {
      validPlan = {
        taskId: 'test-task-1',
        originalRequest: 'Test request',
        title: 'Valid Task',
        description: 'A valid test task',
        subtasks: [
          {
            sequence: 1,
            title: 'First subtask',
            description: 'First step',
            inputs: {
              description: 'No inputs',
              sources: [],
              context: {},
            },
            outputs: {
              description: 'Output file',
              files: ['output.md'],
              summaryFile: 'subtask-1/summary.md',
              markdownRequirements: [
                {
                  id: 'findings',
                  title: 'Findings',
                  content: 'Key findings',
                  required: true,
                },
              ],
            },
            complexity: 'simple',
          },
        ],
        totalSteps: 1,
        createdAt: new Date().toISOString(),
      };
    });

    it('should accept valid plan', () => {
      expect(() => {
        planner['validatePlan'](validPlan);
      }).not.toThrow();
    });

    it('should reject plan with empty title', () => {
      validPlan.title = '';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('Plan must have a title');
    });

    it('should reject plan with only whitespace title', () => {
      validPlan.title = '   ';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('Plan must have a title');
    });

    it('should reject plan with no subtasks', () => {
      validPlan.subtasks = [];

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('Plan must have at least one subtask');
    });

    it('should reject plan with more than 10 subtasks', () => {
      validPlan.subtasks = Array.from({ length: 11 }, (_, i) => ({
        sequence: i + 1,
        title: `Subtask ${i + 1}`,
        description: `Step ${i + 1}`,
        inputs: { description: 'Input', sources: [], context: {} },
        outputs: {
          description: 'Output',
          files: [`subtask-${i + 1}/out.md`],
          summaryFile: `subtask-${i + 1}/summary.md`,
          markdownRequirements: [],
        },
        complexity: 'simple',
      }));
      validPlan.totalSteps = 11;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('Plan should have at most 10 subtasks');
    });

    it('should reject subtask with incorrect sequence number', () => {
      validPlan.subtasks[0].sequence = 2;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('has incorrect sequence number');
    });

    it('should reject subtask with empty title', () => {
      validPlan.subtasks[0].title = '';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have a title');
    });

    it('should reject subtask with empty description', () => {
      validPlan.subtasks[0].description = '';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have a description');
    });

    it('should reject subtask without inputs', () => {
      delete (validPlan.subtasks[0] as any).inputs;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have inputs and outputs');
    });

    it('should reject subtask without outputs', () => {
      delete (validPlan.subtasks[0] as any).outputs;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have inputs and outputs');
    });

    it('should reject subtask without summaryFile', () => {
      delete validPlan.subtasks[0].outputs.summaryFile;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must specify a summaryFile');
    });

    it('should accept subtask with valid markdown requirements', () => {
      expect(() => {
        planner['validatePlan'](validPlan);
      }).not.toThrow();
    });

    it('should reject markdown requirement without id', () => {
      validPlan.subtasks[0].outputs.markdownRequirements![0].id = '';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have an id');
    });

    it('should reject markdown requirement without title', () => {
      validPlan.subtasks[0].outputs.markdownRequirements![0].title = '';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have a title');
    });

    it('should reject markdown requirement without content', () => {
      validPlan.subtasks[0].outputs.markdownRequirements![0].content = '';

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must have content description');
    });

    it('should reject markdown requirement without required field', () => {
      delete validPlan.subtasks[0].outputs.markdownRequirements![0].required;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('must specify required as boolean');
    });

    it('should reject duplicate markdown requirement IDs', () => {
      validPlan.subtasks[0].outputs.markdownRequirements!.push({
        id: 'findings',
        title: 'Another Findings',
        content: 'Duplicate ID',
        required: false,
      });

      expect(() => {
        planner['validatePlan'](validPlan);
      }).toThrow('duplicate markdown requirement id');
    });

    it('should accept subtask without markdown requirements', () => {
      validPlan.subtasks[0].outputs.markdownRequirements = undefined;

      expect(() => {
        planner['validatePlan'](validPlan);
      }).not.toThrow();
    });
  });

  describe('validateInterStepReferences()', () => {
    let validPlan: LongTaskPlan;

    beforeEach(() => {
      validPlan = {
        taskId: 'test-task-1',
        originalRequest: 'Test request',
        title: 'Valid Task',
        description: 'A valid test task',
        subtasks: [
          {
            sequence: 1,
            title: 'First subtask',
            description: 'First step',
            inputs: {
              description: 'No inputs',
              sources: [],
              context: {},
            },
            outputs: {
              description: 'Output file',
              files: ['output.md'],
              summaryFile: 'subtask-1/summary.md',
              markdownRequirements: [
                {
                  id: 'findings',
                  title: 'Findings',
                  content: 'Key findings',
                  required: true,
                },
                {
                  id: 'recommendations',
                  title: 'Recommendations',
                  content: 'Action items',
                  required: false,
                },
              ],
            },
            complexity: 'simple',
          },
          {
            sequence: 2,
            title: 'Second subtask',
            description: 'Second step',
            inputs: {
              description: 'Uses output from step 1',
              sources: ['subtask-1/summary.md#findings', 'subtask-1/summary.md#recommendations'],
              context: {},
            },
            outputs: {
              description: 'Final output',
              files: ['final.md'],
              summaryFile: 'subtask-2/summary.md',
              markdownRequirements: [],
            },
            complexity: 'medium',
          },
        ],
        totalSteps: 2,
        createdAt: new Date().toISOString(),
      };
    });

    it('should accept valid inter-step references', () => {
      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).not.toThrow();
    });

    it('should reject reference to future step', () => {
      validPlan.subtasks[1].inputs.sources = ['subtask-3/summary.md'];

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).toThrow('references future or current step');
    });

    it('should reject reference to current step', () => {
      validPlan.subtasks[1].inputs.sources = ['subtask-2/summary.md'];

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).toThrow('references future or current step');
    });

    it('should reject reference to non-existent section', () => {
      validPlan.subtasks[1].inputs.sources = ['subtask-1/summary.md#nonexistent'];

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).toThrow("references undefined section 'nonexistent'");
    });

    it('should reject reference to section from step without markdown requirements', () => {
      validPlan.subtasks[0].outputs.markdownRequirements = undefined;
      validPlan.subtasks[1].inputs.sources = ['subtask-1/summary.md#findings'];

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).toThrow('has no markdown requirements defined');
    });

    it('should accept reference without section ID', () => {
      validPlan.subtasks[1].inputs.sources = ['subtask-1/summary.md'];

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).not.toThrow();
    });

    it('should accept multiple valid references', () => {
      validPlan.subtasks.push({
        sequence: 3,
        title: 'Third subtask',
        description: 'Third step',
        inputs: {
          description: 'Uses outputs from steps 1 and 2',
          sources: [
            'subtask-1/summary.md#findings',
            'subtask-1/summary.md#recommendations',
            'subtask-2/summary.md',
          ],
          context: {},
        },
        outputs: {
          description: 'Final output',
          files: ['final.md'],
          summaryFile: 'subtask-3/summary.md',
          markdownRequirements: [],
        },
        complexity: 'complex',
      });
      validPlan.totalSteps = 3;

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).not.toThrow();
    });

    it('should handle sources array being undefined', () => {
      validPlan.subtasks[1].inputs.sources = undefined;

      expect(() => {
        planner['validateInterStepReferences'](validPlan);
      }).not.toThrow();
    });
  });

  describe('planTask()', () => {
    const mockPlanResponse = {
      title: 'Sample Task',
      description: 'A sample task plan',
      subtasks: [
        {
          sequence: 1,
          title: 'Research',
          description: 'Conduct research',
          inputs: {
            description: 'User input',
            sources: [],
            context: {},
          },
          outputs: {
            description: 'Research findings',
            files: ['research.md'],
            summaryFile: 'subtask-1/summary.md',
            markdownRequirements: [
              {
                id: 'findings',
                title: 'Key Findings',
                content: 'Main discoveries',
                required: true,
              },
            ],
          },
          complexity: 'medium',
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(loadSkill).mockResolvedValue({
        success: false,
        error: 'Not found',
      });
    });

    it('should initialize automatically if not initialized', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      expect(planner['initialized']).toBe(true);
    });

    it('should call SDK query with planning prompt', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      expect(query).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(query).mock.calls[0];
      expect(callArgs[0].prompt).toContain('Test request');
    });

    it('should set bypassPermissions mode', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      const callArgs = vi.mocked(query).mock.calls[0];
      expect(callArgs[0].options.permissionMode).toBe('bypassPermissions');
    });

    it('should set working directory from config', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      const callArgs = vi.mocked(query).mock.calls[0];
      expect(callArgs[0].options.cwd).toBe('/test/workspace');
    });

    it('should use default model if not specified', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      const callArgs = vi.mocked(query).mock.calls[0];
      expect(callArgs[0].options.model).toBe(model);
    });

    it('should use custom model if provided', async () => {
      const customModel = 'claude-3-opus-20240229';
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request', { model: customModel });

      const callArgs = vi.mocked(query).mock.calls[0];
      expect(callArgs[0].options.model).toBe(customModel);
    });

    it('should use custom API base URL if provided', async () => {
      const customBaseUrl = 'https://custom.api.url';
      const plannerWithBaseUrl = new TaskPlanner(apiKey, model, customBaseUrl);
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await plannerWithBaseUrl.planTask('Test request');

      expect(vi.mocked(query).mock.calls[0][0].options.env).toHaveProperty('ANTHROPIC_API_BASE_URL', customBaseUrl);
    });

    it('should return valid LongTaskPlan', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask('Test request');

      expect(plan.taskId).toMatch(/^long-task-\d+-[a-z0-9]{6}$/);
      expect(plan.originalRequest).toBe('Test request');
      expect(plan.title).toBe('Sample Task');
      expect(plan.subtasks).toHaveLength(1);
      expect(plan.totalSteps).toBe(1);
      expect(plan.createdAt).toBeDefined();
    });

    it('should handle multi-message SDK response', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: '{"title":"', metadata: {} };
          yield { content: 'Multi",', metadata: {} };
          yield { content: '"subtasks":[{"sequence":1,"title":"Test","description":"Test","inputs":{"description":"","sources":[],"context":{}},"outputs":{"description":"","files":[],"summaryFile":"summary.md"}}]}', metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask('Test request');

      expect(plan.title).toBe('Multi');
    });

    it('should throw on SDK query failure', async () => {
      const mockQuery = vi.fn().mockImplementation(() => {
        throw new Error('SDK connection failed');
      });
      vi.mocked(query).mockImplementation(mockQuery);

      await expect(planner.planTask('Test request')).rejects.toThrow('Task planning failed');
    });

    it('should include error details in thrown error', async () => {
      const mockQuery = vi.fn().mockImplementation(() => {
        throw new Error('Specific error details');
      });
      vi.mocked(query).mockImplementation(mockQuery);

      await expect(planner.planTask('Test request')).rejects.toThrow('Specific error details');
    });

    it('should validate plan before returning', async () => {
      const invalidPlan = {
        title: '',
        subtasks: [],
      };
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(invalidPlan), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await expect(planner.planTask('Test request')).rejects.toThrow(/Task planning failed.*Plan must have/);
    });

    it('should use skill-based allowed tools when skill loaded', async () => {
      const mockSkill = {
        name: 'planner',
        content: 'Custom instructions',
        allowedTools: ['Read', 'Glob'],
      };
      vi.mocked(loadSkill).mockResolvedValue({
        success: true,
        skill: mockSkill,
      });

      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      expect(vi.mocked(query).mock.calls[0][0].options.allowedTools).toEqual(['Read', 'Glob']);
    });

    it('should use default allowed tools when no skill loaded', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(mockPlanResponse), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await planner.planTask('Test request');

      expect(vi.mocked(query).mock.calls[0][0].options.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Bash']);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      // Mock loadSkill for edge cases
      vi.mocked(loadSkill).mockResolvedValue({
        success: false,
        error: 'Not found',
      });
    });

    it('should handle very long user requests', async () => {
      const longRequest = 'Test request '.repeat(1000);
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield {
            content: JSON.stringify({
              title: 'Long Request Task',
              subtasks: [{ sequence: 1, title: 'Handle long request', description: 'Process', inputs: { description: 'Input', sources: [], context: {} }, outputs: { description: 'Output', files: ['out.md'], summaryFile: 'subtask-1/summary.md' }, complexity: 'simple' }],
            }),
            metadata: {},
          };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask(longRequest);

      expect(plan.originalRequest).toBe(longRequest);
    });

    it('should handle special characters in request', async () => {
      const specialRequest = 'Test with emojis 🎉 and special chars: <>&"\'\\n';
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield {
            content: JSON.stringify({
              title: 'Special Characters Task',
              subtasks: [{ sequence: 1, title: 'Handle special chars', description: 'Process', inputs: { description: 'Input', sources: [], context: {} }, outputs: { description: 'Output', files: ['out.md'], summaryFile: 'subtask-1/summary.md' }, complexity: 'simple' }],
            }),
            metadata: {},
          };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask(specialRequest);

      expect(plan.originalRequest).toBe(specialRequest);
    });

    it('should handle empty SDK response gracefully', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: '', metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await expect(planner.planTask('Test request')).rejects.toThrow();
    });

    it('should handle response with only whitespace', async () => {
      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: '   \n\t  ', metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      await expect(planner.planTask('Test request')).rejects.toThrow();
    });

    it('should handle plan with maximum allowed subtasks (10)', async () => {
      const maxSubtasks = Array.from({ length: 10 }, (_, i) => ({
        sequence: i + 1,
        title: `Subtask ${i + 1}`,
        description: `Step ${i + 1}`,
        inputs: { description: 'Input', sources: [], context: {} },
        outputs: {
          description: 'Output',
          files: [`subtask-${i + 1}/out.md`],
          summaryFile: `subtask-${i + 1}/summary.md`,
          markdownRequirements: [],
        },
        complexity: 'simple',
      }));

      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield {
            content: JSON.stringify({
              title: 'Max Subtasks',
              subtasks: maxSubtasks,
            }),
            metadata: {},
          };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask('Test request');

      expect(plan.totalSteps).toBe(10);
    });

    it('should handle deeply nested markdown requirements', async () => {
      const complexPlan = {
        title: 'Complex Task',
        subtasks: [
          {
            sequence: 1,
            title: 'Complex Subtask',
            description: 'Step with complex structure',
            inputs: { description: 'Input', sources: [], context: { deep: { nesting: { value: 123 } } } },
            outputs: {
              description: 'Output',
              files: ['out.md'],
              summaryFile: 'subtask-1/summary.md',
              markdownRequirements: Array.from({ length: 5 }, (_, i) => ({
                id: `section-${i}`,
                title: `Section ${i}`,
                content: `Content for section ${i}`,
                required: i < 3,
              })),
            },
            complexity: 'complex',
          },
        ],
      };

      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(complexPlan), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask('Test request');

      expect(plan.subtasks[0].outputs.markdownRequirements).toHaveLength(5);
    });

    it('should handle plan with all complexity levels', async () => {
      const allComplexities = {
        title: 'All Complexities',
        subtasks: [
          {
            sequence: 1,
            title: 'Simple',
            description: 'Simple step',
            inputs: { description: 'Input', sources: [], context: {} },
            outputs: { description: 'Output', files: ['out.md'], summaryFile: 'subtask-1/summary.md' },
            complexity: 'simple',
          },
          {
            sequence: 2,
            title: 'Medium',
            description: 'Medium step',
            inputs: { description: 'Input', sources: [], context: {} },
            outputs: { description: 'Output', files: ['out.md'], summaryFile: 'subtask-2/summary.md' },
            complexity: 'medium',
          },
          {
            sequence: 3,
            title: 'Complex',
            description: 'Complex step',
            inputs: { description: 'Input', sources: [], context: {} },
            outputs: { description: 'Output', files: ['out.md'], summaryFile: 'subtask-3/summary.md' },
            complexity: 'complex',
          },
        ],
      };

      const mockQuery = vi.fn().mockReturnValue(
        (async function* () {
          yield { content: JSON.stringify(allComplexities), metadata: {} };
        })()
      );
      vi.mocked(query).mockImplementation(mockQuery);

      const plan = await planner.planTask('Test request');

      expect(plan.subtasks[0].complexity).toBe('simple');
      expect(plan.subtasks[1].complexity).toBe('medium');
      expect(plan.subtasks[2].complexity).toBe('complex');
    });
  });
});
