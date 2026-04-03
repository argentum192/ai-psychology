/**
 * Data Retention Utility
 * Provides functions to clean up old data from the database
 */

import { logError, logWarning } from './logger.js';

/**
 * Delete chat logs older than the specified number of days
 * @param {D1Database} db - D1 database instance
 * @param {number} retentionDays - Number of days to retain data (default: 90)
 * @param {Object} env - Environment object for logging
 * @returns {Promise<{success: boolean, deletedCount: number}>}
 */
export async function cleanupOldChatLogs(db, retentionDays = 90, env = null) {
  try {
    const result = await db
      .prepare(`DELETE FROM chat_logs WHERE timestamp < datetime('now', '-${retentionDays} days')`)
      .run();
    
    return {
      success: result.success,
      deletedCount: result.meta.changes || 0
    };
  } catch (error) {
    if (env) {
      await logError(env, {
        level: 'error',
        category: 'database',
        message: '清理旧聊天日志失败',
        error
      });
    }
    throw error;
  }
}

/**
 * Delete error logs older than the specified number of days
 * @param {D1Database} db - D1 database instance
 * @param {number} retentionDays - Number of days to retain data (default: 90)
 * @param {Object} env - Environment object for logging
 * @returns {Promise<{success: boolean, deletedCount: number}>}
 */
export async function cleanupOldErrorLogs(db, retentionDays = 90, env = null) {
  try {
    const result = await db
      .prepare(`DELETE FROM error_logs WHERE created_at < datetime('now', '-${retentionDays} days')`)
      .run();
    
    return {
      success: result.success,
      deletedCount: result.meta.changes || 0
    };
  } catch (error) {
    if (env) {
      await logError(env, {
        level: 'error',
        category: 'database',
        message: '清理旧错误日志失败',
        error
      });
    }
    throw error;
  }
}

/**
 * Run all cleanup tasks
 * @param {D1Database} db - D1 database instance
 * @param {Object} [options] - Retention options
 * @param {number} [options.chatLogsRetentionDays] - Days to retain chat logs
 * @param {number} [options.errorLogsRetentionDays] - Days to retain error logs
 * @returns {Promise<Object>}
 */
export async function runDataRetentionCleanup(db, options = {}) {
  const {
    chatLogsRetentionDays = 90,
    errorLogsRetentionDays = 90
  } = options;

  const results = {
    timestamp: new Date().toISOString(),
    chatLogs: null,
    errorLogs: null,
    errors: []
  };

  // Cleanup chat logs
  try {
    results.chatLogs = await cleanupOldChatLogs(db, chatLogsRetentionDays);
  } catch (error) {
    results.errors.push({
      task: 'chatLogs',
      error: error.message
    });
  }

  // Cleanup error logs
  try {
    results.errorLogs = await cleanupOldErrorLogs(db, errorLogsRetentionDays);
  } catch (error) {
    results.errors.push({
      task: 'errorLogs',
      error: error.message
    });
  }

  return results;
}

/**
 * Get statistics about data age and size
 * @param {D1Database} db - D1 database instance
 * @param {Object} env - Environment object for logging
 * @returns {Promise<Object>}
 */
export async function getDataRetentionStats(db, env = null) {
  try {
    const [chatStats, errorStats] = await Promise.all([
      db.prepare(`
        SELECT 
          COUNT(*) as total_count,
          MIN(timestamp) as oldest_record,
          MAX(timestamp) as newest_record,
          COUNT(CASE WHEN timestamp < datetime('now', '-90 days') THEN 1 END) as old_records_90d
        FROM chat_logs
      `).first(),
      
      db.prepare(`
        SELECT 
          COUNT(*) as total_count,
          MIN(created_at) as oldest_record,
          MAX(created_at) as newest_record,
          COUNT(CASE WHEN created_at < datetime('now', '-90 days') THEN 1 END) as old_records_90d
        FROM error_logs
      `).first()
    ]);

    return {
      chatLogs: chatStats,
      errorLogs: errorStats
    };
  } catch (error) {
    if (env) {
      await logError(env, {
        level: 'error',
        category: 'database',
        message: '获取数据保留统计失败',
        error
      });
    }
    throw error;
  }
}
