import jwt from '@tsndr/cloudflare-worker-jwt';
import { getJwtSecret, getAdminSecret, JWT_EXPIRY, MIN_PASSWORD_LENGTH, BCRYPT_SALT_ROUNDS } from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { runDataRetentionCleanup, getDataRetentionStats } from '../utils/dataRetention.js';
import { 
  asyncHandler, 
  validateRequired, 
  validateUserId, 
  authError,
  AppError,
  ErrorType 
} from '../utils/errorHandler.js';
import { getPerformanceStats, cleanupOldMetrics } from '../utils/performanceTracker.js';

/**
 * 将字段数组转换为CSV行
 * @param {Array<*>} fields - 字段数组
 * @returns {string} CSV格式的行
 */
function toCsvLine(fields) {
  return fields
    .map((value) => {
      const text = value == null ? '' : String(value);
      const needsQuoting = /[",\n\r]/.test(text);
      const escaped = text.replace(/"/g, '""');
      return needsQuoting ? `"${escaped}"` : escaped;
    })
    .join(',');
}

/**
 * 管理员登录处理
 * @param {Object} context - 请求上下文
 * @returns {Promise<Response>} HTTP响应
 */
async function adminLoginHandler(context) {
  const { request, env } = context;

  const { secret } = await request.json();

  validateRequired({ secret }, ['secret']);

  const expectedSecret = getAdminSecret(env);
  if (secret !== expectedSecret) {
    throw authError('后台口令错误');
  }

  const jwtSecret = getJwtSecret(env);
  const payload = {
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY.ADMIN
  };
  
  const token = await jwt.sign(payload, jwtSecret);

  return new Response(JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const login = asyncHandler(adminLoginHandler);

/**
 * 获取用户列表
 * @param {Object} context - 请求上下文
 * @returns {Promise<Response>} HTTP响应
 */
async function listUsersHandler(context) {
  const { env } = context;

  const query = await env.ai_psychology_db.prepare(
    `SELECT u.id, u.name, u.created_at, IFNULL(COUNT(c.id), 0) AS message_count
     FROM users u
     LEFT JOIN chat_logs c ON u.id = c.user_id
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  ).all();

  return new Response(JSON.stringify(query.results), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const listUsers = asyncHandler(listUsersHandler);

/**
 * 获取用户聊天历史
 * @param {Object} context - 请求上下文
 * @param {number} userId - 用户ID
 * @returns {Promise<Response>} HTTP响应
 */
async function getUserHistoryHandler(context, userId) {
  const { env } = context;

  const validUserId = validateUserId(userId);

  // 先检查用户是否存在
  const user = await env.ai_psychology_db.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(validUserId).first();

  if (!user) {
    throw new AppError('用户不存在', 404, ErrorType.NOT_FOUND);
  }

  const history = await env.ai_psychology_db.prepare(
    `SELECT sender, message, timestamp
     FROM chat_logs
     WHERE user_id = ?
     ORDER BY timestamp ASC`
  ).bind(validUserId).all();

  return new Response(JSON.stringify(history.results), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const getUserHistory = asyncHandler(getUserHistoryHandler);

/**
 * 删除用户
 * @param {Object} context - 请求上下文
 * @param {number} userId - 用户ID
 * @returns {Promise<Response>} HTTP响应
 */
async function deleteUserHandler(context, userId) {
  const { env } = context;

  const validUserId = validateUserId(userId);

  // 先删除聊天记录
  await env.ai_psychology_db.prepare(
    'DELETE FROM chat_logs WHERE user_id = ?'
  ).bind(validUserId).run();

  // 再删除用户
  const deleteUserResult = await env.ai_psychology_db.prepare(
    'DELETE FROM users WHERE id = ?'
  ).bind(validUserId).run();

  const changes = deleteUserResult?.meta?.changes ?? 0;
  if (changes === 0) {
    throw new AppError('用户不存在', 404, ErrorType.NOT_FOUND);
  }

  return new Response(null, { status: 204 });
}

export const deleteUser = asyncHandler(deleteUserHandler);

/**
 * 导出用户聊天历史为CSV
 * @param {Object} context - 请求上下文
 * @param {number} userId - 用户ID
 * @returns {Promise<Response>} HTTP响应
 */
async function exportUserHistoryHandler(context, userId) {
  const { env } = context;

  const validUserId = validateUserId(userId);

  // 先检查用户是否存在
  const user = await env.ai_psychology_db.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(validUserId).first();

  if (!user) {
    throw new AppError('用户不存在', 404, ErrorType.NOT_FOUND);
  }

  const history = await env.ai_psychology_db.prepare(
    `SELECT sender, message, timestamp
     FROM chat_logs
     WHERE user_id = ?
     ORDER BY timestamp ASC`
  ).bind(validUserId).all();

  const rows = history.results ?? [];
  const header = toCsvLine(['sender', 'message', 'timestamp']);
  const body = rows.map((row) => toCsvLine([row.sender, row.message, row.timestamp])).join('\r\n');
  const csv = `\uFEFF${header}${rows.length ? '\r\n' + body : ''}`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chat_history_user_${validUserId}.csv"`
    }
  });
}

export const exportUserHistory = asyncHandler(exportUserHistoryHandler);

export async function listRegistrationCodes(context) {
  const { env } = context;

  try {
    const query = await env.ai_psychology_db.prepare(
      `SELECT id, code, is_active, created_at
       FROM registration_codes
       ORDER BY created_at DESC`
    ).all();

    return new Response(JSON.stringify(query.results), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '获取注册码列表失败: ' + error.message,
      error,
      endpoint: '/api/admin/registration-codes',
      method: 'GET',
      request: context.request
    });
    return new Response('获取注册码列表失败', { status: 500 });
  }
}

export async function createRegistrationCode(context) {
  const { request, env } = context;

  try {
    const { code } = await request.json();

    if (!code || typeof code !== 'string' || code.trim() === '') {
      return new Response('注册码不能为空', { status: 400 });
    }

    await env.ai_psychology_db.prepare(
      'INSERT INTO registration_codes (code) VALUES (?)'
    ).bind(code.trim()).run();

    return new Response('注册码创建成功', { status: 201 });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '创建注册码失败: ' + error.message,
      error,
      endpoint: '/api/admin/registration-codes',
      method: 'POST',
      request
    });
    if (error.message.includes('UNIQUE constraint failed')) {
      return new Response('该注册码已存在', { status: 409 });
    }
    return new Response('创建注册码失败', { status: 500 });
  }
}

export async function toggleRegistrationCode(context, codeId) {
  const { env } = context;

  if (!Number.isInteger(codeId) || codeId <= 0) {
    return new Response('无效的注册码 ID', { status: 400 });
  }

  try {
    const code = await env.ai_psychology_db.prepare(
      'SELECT is_active FROM registration_codes WHERE id = ?'
    ).bind(codeId).first();

    if (!code) {
      return new Response('注册码不存在', { status: 404 });
    }

    const newStatus = code.is_active === 1 ? 0 : 1;
    await env.ai_psychology_db.prepare(
      'UPDATE registration_codes SET is_active = ? WHERE id = ?'
    ).bind(newStatus, codeId).run();

    return new Response(null, { status: 204 });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '切换注册码状态失败: ' + error.message,
      error,
      endpoint: `/api/admin/registration-codes/${codeId}/toggle`,
      method: 'POST',
      request: context.request
    });
    return new Response('切换注册码状态失败', { status: 500 });
  }
}

export async function deleteRegistrationCode(context, codeId) {
  const { env } = context;

  if (!Number.isInteger(codeId) || codeId <= 0) {
    return new Response('无效的注册码 ID', { status: 400 });
  }

  try {
    const deleteResult = await env.ai_psychology_db.prepare(
      'DELETE FROM registration_codes WHERE id = ?'
    ).bind(codeId).run();

    const changes = deleteResult?.meta?.changes ?? 0;
    if (changes === 0) {
      return new Response('注册码不存在', { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '删除注册码失败: ' + error.message,
      error,
      endpoint: `/api/admin/registration-codes/${codeId}`,
      method: 'DELETE',
      request: context.request
    });
    return new Response('删除注册码失败', { status: 500 });
  }
}

export async function resetUserPassword(context, userId) {
  const { request, env } = context;

  if (!Number.isInteger(userId) || userId <= 0) {
    return new Response('无效的用户 ID', { status: 400 });
  }

  try {
    const { new_password } = await request.json();

    if (!new_password || typeof new_password !== 'string') {
      return new Response('新密码不能为空', { status: 400 });
    }

    if (new_password.length < MIN_PASSWORD_LENGTH) {
      return new Response(`密码长度不得小于${MIN_PASSWORD_LENGTH}位`, { status: 400 });
    }

    // 检查用户是否存在
    const user = await env.ai_psychology_db.prepare(
      'SELECT id FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!user) {
      return new Response('用户不存在', { status: 404 });
    }

    // 加密新密码（使用配置的 salt rounds）
    const bcrypt = await import('bcryptjs');
    const salt = bcrypt.genSaltSync(BCRYPT_SALT_ROUNDS);
    const hashedPassword = bcrypt.hashSync(new_password, salt);

    // 更新密码
    await env.ai_psychology_db.prepare(
      'UPDATE users SET hashed_password = ? WHERE id = ?'
    ).bind(hashedPassword, userId).run();

    return new Response('密码重置成功', { status: 200 });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '重置用户密码失败: ' + error.message,
      error,
      userId,
      endpoint: `/api/admin/users/${userId}/reset-password`,
      method: 'POST',
      request
    });
    if (error instanceof SyntaxError) {
      return new Response('请求体格式错误', { status: 400 });
    }
    return new Response('重置密码失败', { status: 500 });
  }
}

// ==================== 日志管理功能 ====================

/**
 * 获取错误日志列表
 * @param {Object} context - 请求上下文
 */
export async function listErrorLogs(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  try {
    // 解析查询参数
    const level = url.searchParams.get('level'); // error, warning, info
    const category = url.searchParams.get('category');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // 构建查询
    let queryStr = `
      SELECT 
        e.id,
        e.level,
        e.category,
        e.message,
        e.stack,
        e.user_id,
        u.name,
        e.endpoint,
        e.method,
        e.ip_address,
        e.created_at
      FROM error_logs e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE 1=1
    `;
    
    const bindings = [];

    if (level) {
      queryStr += ' AND e.level = ?';
      bindings.push(level);
    }

    if (category) {
      queryStr += ' AND e.category = ?';
      bindings.push(category);
    }

    if (startDate) {
      queryStr += ' AND e.created_at >= ?';
      bindings.push(startDate);
    }

    if (endDate) {
      queryStr += ' AND e.created_at <= ?';
      bindings.push(endDate);
    }

    queryStr += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    const result = await env.ai_psychology_db.prepare(queryStr).bind(...bindings).all();

    // 获取总数
    let countQueryStr = 'SELECT COUNT(*) as total FROM error_logs WHERE 1=1';
    const countBindings = [];

    if (level) {
      countQueryStr += ' AND level = ?';
      countBindings.push(level);
    }

    if (category) {
      countQueryStr += ' AND category = ?';
      countBindings.push(category);
    }

    if (startDate) {
      countQueryStr += ' AND created_at >= ?';
      countBindings.push(startDate);
    }

    if (endDate) {
      countQueryStr += ' AND created_at <= ?';
      countBindings.push(endDate);
    }

    const countResult = await env.ai_psychology_db.prepare(countQueryStr).bind(...countBindings).first();

    return new Response(JSON.stringify({
      logs: result.results,
      total: countResult.total,
      limit,
      offset
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '获取错误日志失败: ' + error.message,
      error,
      endpoint: '/api/admin/logs',
      method: 'GET',
      request
    });
    return new Response('获取错误日志失败', { status: 500 });
  }
}

/**
 * 获取日志统计信息
 */
export async function getLogStats(context) {
  const { env, request } = context;

  try {
    // 获取各级别日志数量
    const levelStats = await env.ai_psychology_db.prepare(`
      SELECT level, COUNT(*) as count
      FROM error_logs
      GROUP BY level
    `).all();

    // 获取各类别日志数量
    const categoryStats = await env.ai_psychology_db.prepare(`
      SELECT category, COUNT(*) as count
      FROM error_logs
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `).all();

    // 获取最近24小时的日志数量
    const recentStats = await env.ai_psychology_db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN level = 'warning' THEN 1 ELSE 0 END) as warnings,
        SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) as info
      FROM error_logs
      WHERE created_at >= datetime('now', '-24 hours')
    `).first();

    return new Response(JSON.stringify({
      byLevel: levelStats.results,
      byCategory: categoryStats.results,
      last24Hours: recentStats
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '获取日志统计失败: ' + error.message,
      error,
      endpoint: '/api/admin/logs/stats',
      method: 'GET',
      request
    });
    return new Response('获取日志统计失败', { status: 500 });
  }
}

/**
 * 清除旧日志
 * @param {Object} context - 请求上下文
 */
export async function clearOldLogs(context) {
  const { request, env } = context;

  try {
    const { days = 30 } = await request.json();

    if (!Number.isInteger(days) || days < 1) {
      return new Response('天数必须是大于0的整数', { status: 400 });
    }

    const result = await env.ai_psychology_db.prepare(`
      DELETE FROM error_logs
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).bind(days).run();

    const deletedCount = result?.meta?.changes ?? 0;

    await logInfo(env, 'admin', `清除了 ${deletedCount} 条超过 ${days} 天的日志`, {
      endpoint: '/api/admin/logs/clear',
      method: 'POST',
      request
    });

    return new Response(JSON.stringify({
      message: `已删除 ${deletedCount} 条日志`,
      deletedCount
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '清除旧日志失败: ' + error.message,
      error,
      endpoint: '/api/admin/logs/clear',
      method: 'POST',
      request
    });
    if (error instanceof SyntaxError) {
      return new Response('请求体格式错误', { status: 400 });
    }
    return new Response('清除日志失败', { status: 500 });
  }
}

/**
 * 删除单条日志
 */
export async function deleteErrorLog(context, logId) {
  const { env } = context;

  if (!Number.isInteger(logId) || logId <= 0) {
    return new Response('无效的日志 ID', { status: 400 });
  }

  try {
    const deleteResult = await env.ai_psychology_db.prepare(
      'DELETE FROM error_logs WHERE id = ?'
    ).bind(logId).run();

    const changes = deleteResult?.meta?.changes ?? 0;
    if (changes === 0) {
      return new Response('日志不存在', { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '删除日志失败: ' + error.message,
      error,
      endpoint: `/api/admin/logs/${logId}`,
      method: 'DELETE',
      request: context.request
    });
    return new Response('删除日志失败', { status: 500 });
  }
}

/**
 * Get data retention statistics
 * GET /api/admin/data-retention/stats
 */
export async function getDataRetentionStatistics(context) {
  const { env } = context;

  try {
    const stats = await getDataRetentionStats(env.ai_psychology_db);

    return new Response(JSON.stringify({
      success: true,
      stats
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '获取数据保留统计失败: ' + error.message,
      error,
      endpoint: '/api/admin/data-retention/stats',
      method: 'GET',
      request: context.request
    });
    return new Response('获取统计信息失败', { status: 500 });
  }
}

/**
 * Manually trigger data retention cleanup
 * POST /api/admin/data-retention/cleanup
 */
export async function triggerDataRetentionCleanup(context) {
  const { env, request } = context;

  try {
    // Parse optional retention days from request body
    let chatLogsRetentionDays = 90;
    let errorLogsRetentionDays = 90;

    try {
      const body = await request.json();
      if (body.chatLogsRetentionDays) {
        chatLogsRetentionDays = parseInt(body.chatLogsRetentionDays, 10);
      }
      if (body.errorLogsRetentionDays) {
        errorLogsRetentionDays = parseInt(body.errorLogsRetentionDays, 10);
      }
    } catch (e) {
      // No body or invalid JSON, use defaults
    }

    // Validate retention days
    if (chatLogsRetentionDays < 1 || errorLogsRetentionDays < 1) {
      return new Response('保留天数必须大于 0', { status: 400 });
    }

    const results = await runDataRetentionCleanup(env.ai_psychology_db, {
      chatLogsRetentionDays,
      errorLogsRetentionDays
    });

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '手动触发数据清理失败: ' + error.message,
      error,
      endpoint: '/api/admin/data-retention/cleanup',
      method: 'POST',
      request: context.request
    });
    return new Response('数据清理失败', { status: 500 });
  }
}

/**
 * 获取性能统计信息
 * GET /api/admin/performance/stats
 */
export async function getPerformanceStatistics(context) {
  const { env, request } = context;

  try {
    const url = new URL(request.url);
    const timeRange = url.searchParams.get('timeRange') || '24h';

    const stats = await getPerformanceStats(env.ai_psychology_db, timeRange);

    return new Response(JSON.stringify({
      success: true,
      stats
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '获取性能统计失败: ' + error.message,
      error,
      endpoint: '/api/admin/performance/stats',
      method: 'GET',
      request: context.request
    });
    return new Response('获取性能统计失败', { status: 500 });
  }
}

/**
 * 清理旧的性能指标数据
 * POST /api/admin/performance/cleanup
 */
export async function cleanupPerformanceMetrics(context) {
  const { env, request } = context;

  try {
    let retentionDays = 30;

    try {
      const body = await request.json();
      if (body.retentionDays) {
        retentionDays = parseInt(body.retentionDays, 10);
      }
    } catch (e) {
      // No body or invalid JSON, use defaults
    }

    // Validate retention days
    if (retentionDays < 1) {
      return new Response('保留天数必须大于 0', { status: 400 });
    }

    const deletedCount = await cleanupOldMetrics(env.ai_psychology_db, retentionDays);

    await logInfo(env, 'admin', `清除了 ${deletedCount} 条超过 ${retentionDays} 天的性能指标`, {
      endpoint: '/api/admin/performance/cleanup',
      method: 'POST',
      request
    });

    return new Response(JSON.stringify({
      success: true,
      message: `已删除 ${deletedCount} 条性能指标`,
      deletedCount
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '清理性能指标失败: ' + error.message,
      error,
      endpoint: '/api/admin/performance/cleanup',
      method: 'POST',
      request: context.request
    });
    return new Response('清理性能指标失败', { status: 500 });
  }
}

/**
 * 清除所有数据（仅保留用户表和管理员数据）
 * POST /api/admin/database/clear-all
 */
export async function clearAllData(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    
    // 二次确认，需要传入确认字符串
    if (body.confirmation !== 'CLEAR_ALL_DATA') {
      return new Response(JSON.stringify({
        success: false,
        message: '需要确认字符串: CLEAR_ALL_DATA'
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 清除聊天记录
    const chatLogsResult = await env.ai_psychology_db.prepare(
      'DELETE FROM chat_logs'
    ).run();

    // 清除错误日志
    const errorLogsResult = await env.ai_psychology_db.prepare(
      'DELETE FROM error_logs'
    ).run();

    // 清除性能指标
    const metricsResult = await env.ai_psychology_db.prepare(
      'DELETE FROM performance_metrics'
    ).run();

    const totalDeleted = 
      (chatLogsResult.meta?.changes || 0) + 
      (errorLogsResult.meta?.changes || 0) + 
      (metricsResult.meta?.changes || 0);

    await logInfo(env, 'admin', `管理员清除了所有数据，共删除 ${totalDeleted} 条记录`, {
      endpoint: '/api/admin/database/clear-all',
      method: 'POST',
      request
    });

    return new Response(JSON.stringify({
      success: true,
      message: '所有数据已清除',
      deletedRecords: {
        chatLogs: chatLogsResult.meta?.changes || 0,
        errorLogs: errorLogsResult.meta?.changes || 0,
        performanceMetrics: metricsResult.meta?.changes || 0,
        total: totalDeleted
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: '清除所有数据失败: ' + error.message,
      error,
      endpoint: '/api/admin/database/clear-all',
      method: 'POST',
      request: context.request
    });
    return new Response('清除所有数据失败', { status: 500 });
  }
}

/**
 * 清除特定用户的聊天记录
 * DELETE /api/admin/user/:userId/chat-history
 */
export async function clearUserChatHistory(context, userId) {
  const { env, request } = context;

  try {
    const validUserId = validateUserId(userId);

    // 检查用户是否存在
    const user = await env.ai_psychology_db.prepare(
      'SELECT id, name FROM users WHERE id = ?'
    ).bind(validUserId).first();

    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        message: '用户不存在'
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 删除该用户的所有聊天记录
    const result = await env.ai_psychology_db.prepare(
      'DELETE FROM chat_logs WHERE user_id = ?'
    ).bind(validUserId).run();

    const deletedCount = result.meta?.changes || 0;

    await logInfo(env, 'admin', `管理员清除了用户 ${user.name} (ID: ${validUserId}) 的聊天记录，共删除 ${deletedCount} 条`, {
      endpoint: `/api/admin/user/${userId}/chat-history`,
      method: 'DELETE',
      request
    });

    return new Response(JSON.stringify({
      success: true,
      message: `已清除用户 ${user.name} 的 ${deletedCount} 条聊天记录`,
      deletedCount
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await logError(env, {
      level: 'error',
      category: 'admin',
      message: `清除用户 ${userId} 的聊天记录失败: ` + error.message,
      error,
      endpoint: `/api/admin/user/${userId}/chat-history`,
      method: 'DELETE',
      request: context.request
    });
    return new Response('清除用户聊天记录失败', { status: 500 });
  }
}
