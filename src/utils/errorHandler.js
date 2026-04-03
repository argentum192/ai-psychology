/**
 * @fileoverview 统一的错误处理中间件,用于标准化API错误响应
 */

import { logError, logWarning } from './logger.js';

/**
 * 错误类型枚举
 * @readonly
 * @enum {string}
 */
export const ErrorType = {
  VALIDATION: 'validation',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  DATABASE: 'database',
  NETWORK: 'network',
  INTERNAL: 'internal'
};

/**
 * 自定义应用错误类
 * @class
 */
export class AppError extends Error {
  /**
   * @param {string} message - 错误消息
   * @param {number} statusCode - HTTP状态码
   * @param {ErrorType} type - 错误类型
   * @param {Object} [details] - 额外的错误详情
   */
  constructor(message, statusCode, type, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.details = details;
    this.isOperational = true; // 标记为可预期的操作错误
  }
}

/**
 * 包装异步处理器,自动捕获错误
 * @param {Function} handler - 异步处理函数
 * @returns {Function} 包装后的处理函数
 */
export function asyncHandler(handler) {
  return async (context, ...args) => {
    try {
      return await handler(context, ...args);
    } catch (error) {
      return handleError(error, context);
    }
  };
}

/**
 * 统一的错误处理函数
 * @param {Error} error - 错误对象
 * @param {Object} context - 请求上下文 {request, env, data}
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleError(error, context) {
  const { request, env, data } = context;

  // 如果是自定义应用错误
  if (error instanceof AppError) {
    // 根据错误类型决定日志级别
    if (error.statusCode >= 500) {
      await logError(env, {
        level: 'error',
        category: error.type,
        message: error.message,
        error,
        userId: data?.user?.id,
        endpoint: new URL(request.url).pathname,
        method: request.method,
        request
      });
    } else if (error.statusCode >= 400) {
      await logWarning(env, error.type, error.message, {
        endpoint: new URL(request.url).pathname,
        method: request.method,
        userId: data?.user?.id,
        request
      });
    }

    return new Response(error.message, {
      status: error.statusCode,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  // 处理特定的已知错误
  // JSON 解析错误
  if (error instanceof SyntaxError && error.message.includes('JSON')) {
    await logWarning(env, 'validation', '请求体JSON格式错误', {
      endpoint: new URL(request.url).pathname,
      method: request.method,
      request
    });
    return new Response('请求体格式错误', { status: 400 });
  }

  // 数据库唯一约束错误
  if (error.message && error.message.includes('UNIQUE constraint failed')) {
    const match = error.message.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
    const field = match ? match[2] : '字段';
    
    await logWarning(env, 'database', `数据库唯一约束冲突: ${field}`, {
      endpoint: new URL(request.url).pathname,
      method: request.method,
      request,
      error // 添加错误对象以记录堆栈
    });

    // 根据字段返回友好的错误消息
    if (field === 'name') {
      return new Response('该姓名已被注册', { status: 409 });
    }
    return new Response(`该${field}已存在`, { status: 409 });
  }

  // 未预期的服务器错误
  await logError(env, {
    level: 'error',
    category: 'internal',
    message: '服务器内部错误: ' + error.message,
    error,
    userId: data?.user?.id,
    endpoint: new URL(request.url).pathname,
    method: request.method,
    stack: error.stack,
    request
  });

  return new Response('服务器内部错误', { status: 500 });
}

/**
 * 验证必需字段
 * @param {Object} data - 要验证的数据对象
 * @param {string[]} requiredFields - 必需字段数组
 * @throws {AppError} 如果缺少必需字段
 */
export function validateRequired(data, requiredFields) {
  const missing = requiredFields.filter(field => !data[field]);
  
  if (missing.length > 0) {
    throw new AppError(
      `缺少必需字段: ${missing.join(', ')}`,
      400,
      ErrorType.VALIDATION,
      { missingFields: missing }
    );
  }
}

/**
 * 验证密码强度
 * @param {string} password - 密码
 * @param {number} minLength - 最小长度
 * @throws {AppError} 如果密码不符合要求
 */
export function validatePassword(password, minLength) {
  if (!password || password.length < minLength) {
    throw new AppError(
      `密码长度不得小于${minLength}位`,
      400,
      ErrorType.VALIDATION
    );
  }
}

/**
 * 验证用户ID
 * @param {*} userId - 用户ID
 * @throws {AppError} 如果用户ID无效
 */
export function validateUserId(userId) {
  const id = parseInt(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('无效的用户 ID', 400, ErrorType.VALIDATION);
  }
  return id;
}

/**
 * 检查数据库查询结果
 * @param {Object|null} result - 数据库查询结果
 * @param {string} errorMessage - 错误消息
 * @throws {AppError} 如果结果为空
 * @returns {Object} 查询结果
 */
export function assertFound(result, errorMessage) {
  if (!result) {
    throw new AppError(errorMessage, 404, ErrorType.NOT_FOUND);
  }
  return result;
}

/**
 * 创建认证错误
 * @param {string} [message='认证失败'] - 错误消息
 * @returns {AppError} 认证错误
 */
export function authError(message = '认证失败') {
  return new AppError(message, 401, ErrorType.AUTHENTICATION);
}

/**
 * 创建授权错误
 * @param {string} [message='权限不足'] - 错误消息
 * @returns {AppError} 授权错误
 */
export function forbiddenError(message = '权限不足') {
  return new AppError(message, 403, ErrorType.AUTHORIZATION);
}
