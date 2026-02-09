/**
 * Agent module exports.
 *
 * Architecture (Plan-and-Execute):
 * - Scout: Task initialization - creates Task.md with metadata
 * - Evaluator: Task completion evaluation
 * - Worker: Simple task execution
 * - TaskPlanner: Breaks down complex tasks into subtasks
 * - SubtaskExecutor: Executes individual subtasks
 * - DialogueOrchestrator: Manages direct Evaluator-Planner/Executor flow
 *
 * Complete Workflow:
 * Flow 1: User request → Scout → Task.md (metadata + original request)
 * Flow 2: Task.md → Evaluator → Planner/Executor (plan + execute) → ...
 *
 * Plan-and-Execute Flow:
 * - TaskPlanner breaks down complex tasks into subtasks
 * - For simple tasks: Worker executes directly
 * - For complex tasks: SubtaskExecutor runs each subtask with fresh Worker instances
 * - Sequential handoff with context passing
 * - Results aggregated for final output
 *
 * Session Management:
 * - Orchestrator internally manages sessions per messageId
 * - SDK's native resume parameter handles session persistence
 */

// Core agents
export { Scout } from './scout.js';
export { Worker, type WorkerConfig } from './worker.js';
export { Evaluator } from './evaluator.js';

// Note: WorkerEnhanced has been removed - replaced by direct use of TaskPlanner + SubtaskExecutor

// Bridges
export {
  DialogueOrchestrator,
  type DialogueOrchestratorConfig,
  type TaskPlanData,
} from './dialogue-orchestrator.js';

export {
  IterationBridge,
  type IterationBridgeConfig,
  type IterationResult,
} from './iteration-bridge.js';

// Supporting modules
export { DialogueMessageTracker } from './dialogue-message-tracker.js';
export { parseBaseToolName, isUserFeedbackTool, isTaskDoneTool } from './mcp-utils.js';

// Feishu context MCP tools
export {
  feishuContextTools,
  send_user_feedback,
  send_file_to_feishu,
} from '../mcp/feishu-context-mcp.js';

// Note: task_done is now an inline tool provided by the Evaluator agent
// and is not exported from the Feishu MCP server anymore

// Utility
export { extractText } from '../utils/sdk.js';
