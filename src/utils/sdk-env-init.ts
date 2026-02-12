/**
 * SDK Environment Initialization utility.
 *
 * This module handles the setup of required directories and configurations
 * for the Claude Agent SDK to function properly.
 *
 * Key responsibilities:
 * - Ensure global SDK directories exist
 * - Create workspace-specific SDK structure
 * - Set up skills directories
 */

import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from './logger.js';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger('SdkEnvInit');

/**
 * Result of SDK environment initialization.
 */
interface SdkEnvInitResult {
  success: boolean;
  directoriesCreated: string[];
  errors: string[];
}

/**
 * Platform-specific global SDK paths.
 */
interface GlobalSdkPaths {
  managedSkills: string;
  userSkills: string;
}

/**
 * Get platform-specific global SDK paths.
 *
 * macOS: /Library/Application Support/ClaudeCode/.claude/skills
 * Linux: ~/.claude/skills
 * Windows: %APPDATA%/ClaudeCode/.claude/skills
 *
 * @returns GlobalSdkPaths object with platform-specific paths
 */
function getGlobalSdkPaths(): GlobalSdkPaths {
  const platform = os.platform();
  const homeDir = os.homedir();

  switch (platform) {
    case 'darwin':
      // macOS: Use system-wide Application Support directory
      return {
        managedSkills: '/Library/Application Support/ClaudeCode/.claude/skills',
        userSkills: path.join(homeDir, '.claude', 'skills'),
      };

    case 'linux':
      // Linux: Use user's home directory
      return {
        managedSkills: path.join(homeDir, '.claude', 'skills'),
        userSkills: path.join(homeDir, '.claude', 'skills'),
      };

    case 'win32':
      // Windows: Use APPDATA
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      return {
        managedSkills: path.join(appData, 'ClaudeCode', '.claude', 'skills'),
        userSkills: path.join(homeDir, '.claude', 'skills'),
      };

    default:
      // Fallback: Use user's home directory
      logger.warn({ platform }, 'Unknown platform, using home directory as fallback');
      return {
        managedSkills: path.join(homeDir, '.claude', 'skills'),
        userSkills: path.join(homeDir, '.claude', 'skills'),
      };
  }
}

/**
 * Create a directory if it doesn't exist.
 *
 * @param dirPath - Directory path to create
 * @param description - Description of the directory for logging
 * @returns Promise<boolean> True if directory exists or was created successfully
 */
async function ensureDirectory(dirPath: string, description: string): Promise<boolean> {
  if (existsSync(dirPath)) {
    logger.debug({ path: dirPath }, `Directory already exists: ${description}`);
    return true;
  }

  try {
    await mkdir(dirPath, { recursive: true });
    logger.info({ path: dirPath }, `Created directory: ${description}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ path: dirPath, error: errorMessage }, `Failed to create directory: ${description}`);
    return false;
  }
}

/**
 * Initialize SDK environment with required directories.
 *
 * This function creates the necessary directories for the Claude Agent SDK
 * to function properly. It handles platform-specific paths and gracefully
 * handles permission errors.
 *
 * Key directories:
 * - Managed skills directory (system-wide)
 * - User skills directory (user-specific)
 * - Workspace skills directory (project-specific)
 *
 * @param workspaceDir - Optional workspace directory path
 * @returns Promise<SdkEnvInitResult> Result object with operation details
 *
 * @example
 * ```typescript
 * const result = await initializeSdkEnvironment('/path/to/workspace');
 * if (result.success) {
 *   console.log(`Created ${result.directoriesCreated.length} directories`);
 * }
 * ```
 */
export async function initializeSdkEnvironment(workspaceDir?: string): Promise<SdkEnvInitResult> {
  const result: SdkEnvInitResult = {
    success: false,
    directoriesCreated: [],
    errors: [],
  };

  logger.info('Initializing SDK environment...');

  // Get platform-specific paths
  const paths = getGlobalSdkPaths();

  // 1. Try to create managed skills directory (may require sudo on macOS)
  const managedCreated = await ensureDirectory(paths.managedSkills, 'Managed SDK skills directory');
  if (managedCreated && !existsSync(paths.managedSkills)) {
    result.directoriesCreated.push(paths.managedSkills);
  } else if (!managedCreated) {
    result.errors.push(`Failed to create managed skills directory: ${paths.managedSkills}`);
    logger.warn(
      { path: paths.managedSkills },
      'Could not create managed skills directory. This may require elevated permissions. Falling back to user directory.'
    );
  }

  // 2. Create user skills directory (always should succeed)
  const userCreated = await ensureDirectory(paths.userSkills, 'User SDK skills directory');
  if (userCreated && !existsSync(paths.userSkills)) {
    result.directoriesCreated.push(paths.userSkills);
  }

  // 3. Create workspace skills directory if workspaceDir provided
  if (workspaceDir) {
    const workspaceSkillsDir = path.join(workspaceDir, '.claude', 'skills');
    const workspaceCreated = await ensureDirectory(workspaceSkillsDir, 'Workspace SDK skills directory');
    if (workspaceCreated && !existsSync(workspaceSkillsDir)) {
      result.directoriesCreated.push(workspaceSkillsDir);
    }
  }

  // Consider initialization successful if at least user directory exists
  result.success = existsSync(paths.userSkills);

  if (result.success) {
    logger.info(
      {
        directoriesCreated: result.directoriesCreated.length,
        errors: result.errors.length,
      },
      'SDK environment initialization complete'
    );
  } else {
    logger.error('SDK environment initialization failed');
  }

  return result;
}

/**
 * Check if SDK environment is properly initialized.
 *
 * @returns boolean True if required directories exist
 */
export function isSdkEnvironmentReady(): boolean {
  const paths = getGlobalSdkPaths();
  return existsSync(paths.managedSkills) || existsSync(paths.userSkills);
}

/**
 * Get SDK environment status information.
 *
 * @returns Object with status information about SDK directories
 */
export function getSdkEnvironmentStatus(): {
  managedSkillsExists: boolean;
  userSkillsExists: boolean;
  platform: string;
  paths: GlobalSdkPaths;
} {
  const paths = getGlobalSdkPaths();

  return {
    managedSkillsExists: existsSync(paths.managedSkills),
    userSkillsExists: existsSync(paths.userSkills),
    platform: os.platform(),
    paths,
  };
}
