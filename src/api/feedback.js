/**
 * @fileoverview 用户反馈API
 * 用于接收用户提交的bug反馈和问题报告
 */

import { logInfo } from '../utils/logger.js';
import { asyncHandler, validateRequired } from '../utils/errorHandler.js';

/**
 * 提交用户反馈
 * POST /api/feedback
 */
async function submitFeedbackHandler(context) {
  const { request, env, data } = context;

  try {
    const { type, message, url, userAgent, screenshot } = await request.json();

    // 验证必填字段
    validateRequired({ type, message }, ['type', 'message']);

    // 获取用户ID（如果已登录）
    const userId = data.user?.id || null;

    // 记录反馈到日志系统
    await logInfo(env, 'user_feedback', `用户反馈 [${type}]: ${message}`, {
      userId,
      endpoint: url || '/api/feedback',
      method: 'POST',
      request,
      metadata: {
        type,
        url,
        userAgent,
        hasScreenshot: !!screenshot
      }
    });

    return new Response(JSON.stringify({
      success: true,
      message: '感谢您的反馈！我们会尽快处理。'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('提交反馈失败:', error);
    
    if (error.name === 'ValidationError') {
      return new Response(JSON.stringify({
        success: false,
        message: error.message
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: false,
      message: '提交反馈失败，请稍后重试'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const submitFeedback = asyncHandler(submitFeedbackHandler);
