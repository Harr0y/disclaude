/**
 * Long task module - orchestrates complex multi-step tasks.
 *
 * Provides a workflow for executing tasks directly without planning.
 * Each task is handled by an isolated agent with context isolation
 * and result persistence.
 */

export { Executor } from '../agents/executor.js';
export { LongTaskTracker } from './tracker.js';
export { TaskPlanExtractor } from './task-plan-extractor.js';
export type {
  SubtaskInput,
  SubtaskOutput,
  Subtask,
  LongTaskPlan,
  LongTaskStatus,
  LongTaskState,
  SubtaskResult,
  LongTaskConfig,
  SubtaskProgressEvent,
} from './types.js';
export type { TaskPlanData } from './task-plan-extractor.js';
export type { DialogueTaskPlan } from './tracker.js';
