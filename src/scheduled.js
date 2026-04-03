/**
 * Scheduled Tasks Handler
 * Handles Cloudflare Workers Cron Triggers for periodic maintenance tasks
 */

import { runDataRetentionCleanup, getDataRetentionStats } from './utils/dataRetention.js';
import { logError, logInfo, debugLog } from './utils/logger.js';

/**
 * Handle scheduled cron triggers
 * @param {ScheduledEvent} event - Cloudflare Workers scheduled event
 * @param {Object} env - Environment bindings
 * @param {ExecutionContext} ctx - Execution context
 */
export async function handleScheduled(event, env, ctx) {
  const { cron } = event;
  
  await logInfo(env, 'scheduled_task', `定时任务触发: ${cron}`);

  try {
    // Run data retention cleanup
    const results = await runDataRetentionCleanup(env.ai_psychology_db, {
      chatLogsRetentionDays: 90,
      errorLogsRetentionDays: 90
    });

    debugLog(env, '数据保留清理完成:', results);

    // Log the results
    if (results.errors.length > 0) {
      await logError(env, {
        level: 'warning',
        category: 'scheduled_task',
        message: `数据保留清理完成，但有错误: ${JSON.stringify(results.errors)}`,
        endpoint: 'cron/data-retention'
      });
    } else {
      // Log success
      await logInfo(env, 'scheduled_task', 
        `数据保留清理成功。聊天日志删除: ${results.chatLogs?.deletedCount || 0}, 错误日志删除: ${results.errorLogs?.deletedCount || 0}`,
        { endpoint: 'cron/data-retention' }
      );
    }

    // Get and log current stats
    const stats = await getDataRetentionStats(env.ai_psychology_db, env);
    debugLog(env, '当前数据保留统计:', stats);

  } catch (error) {
    
    // Log the error
    await logError(env, {
      level: 'error',
      category: 'scheduled_task',
      message: `定时任务失败: ${error.message}`,
      error,
      endpoint: 'cron/data-retention'
    });
  }
}
