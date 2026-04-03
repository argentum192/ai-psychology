/**
 * Cloudflare Workers 主入口文件
 * 
 * 处理所有请求并将其路由到适当的处理程序：
 * - /api/* 路由 → API 函数
 * - 其他路径 → 静态资产
 */

// 导入 API 处理函数
import { onRequestPost as registerHandler } from './api/register.js';
import { onRequestPost as loginHandler } from './api/login.js';
import { onRequestGet as historyHandler } from './api/history.js';
import { submitFeedback } from './api/feedback.js';
import { login as adminLogin, listUsers as adminListUsers, getUserHistory as adminGetUserHistory, deleteUser as adminDeleteUser, exportUserHistory as adminExportUserHistory, listRegistrationCodes, createRegistrationCode, toggleRegistrationCode, deleteRegistrationCode, resetUserPassword, listErrorLogs, getLogStats, clearOldLogs, deleteErrorLog, getDataRetentionStatistics, triggerDataRetentionCleanup, getPerformanceStatistics, cleanupPerformanceMetrics, clearAllData, clearUserChatHistory } from './api/admin.js';
import { getJwtSecret } from './config.js';
import jwt from '@tsndr/cloudflare-worker-jwt';
import { logError, logWarning } from './utils/logger.js';
import { handleScheduled } from './scheduled.js';
import { trackApiResponse } from './utils/performanceTracker.js';

// 导入 Durable Object
export { ChatSession } from './durable-objects/ChatSession.js';

// 中间件：验证 JWT token
async function authenticateRequest(request, env, requiredRole = 'user') {
	const authHeader = request.headers.get('Authorization');
	
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return { success: false, response: new Response('请求未授权', { status: 401 }) };
	}
	
	const token = authHeader.substring(7);
	const jwtSecret = getJwtSecret(env);
	
	try {
		const result = /** @type {CustomJwtPayload} */ (/** @type {unknown} */ (await jwt.verify(token, jwtSecret)));
		
		// jwt.verify 返回的对象包含 header 和 payload
		// 我们需要从 payload 中提取数据
		const payload = result.payload || result;
		const tokenRole = payload.role ?? 'user';
		
		if (requiredRole && tokenRole !== requiredRole) {
			return { success: false, response: new Response('权限不足', { status: 403 }) };
		}

		if (requiredRole === 'admin') {
			return { success: true, admin: { role: tokenRole } };
		}

		if (!payload.id) {
			return { success: false, response: new Response('请求未授权', { status: 401 }) };
		}

		return { success: true, user: { id: payload.id } };
	} catch (err) {
		// 记录认证失败
		await logWarning(env, 'auth', 'JWT Token 验证失败', {
			endpoint: new URL(request.url).pathname,
			method: request.method,
			error: err,
			request
		});
		return { success: false, response: new Response('无效的授权令牌', { status: 401 }) };
	}
}

/**
 * 包装 API 响应并记录性能指标
 */
async function wrapApiResponse(response, env, ctx, pathname, startTime, userId = null) {
	try {
		const duration = Date.now() - startTime;
		const statusCode = response.status;
		
		// 异步记录性能，不阻塞响应
		ctx.waitUntil(
			trackApiResponse(env, pathname, duration, statusCode, userId)
		);
	} catch (error) {
		// 静默失败，不影响实际响应
		console.error('记录 API 性能失败:', error);
	}
	
	return response;
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const { pathname } = url;
		
		// 记录请求开始时间
		const requestStartTime = Date.now();

		// API 路由处理
		if (pathname.startsWith('/api/')) {
			// 临时配置检查端点（无需认证，仅用于验证部署）
			if (pathname === '/api/config-check' && request.method === 'GET') {
				const { DEEPSEEK_MODEL, DEEPSEEK_API_URL, MAX_CONTEXT_TOKENS, MAX_HISTORY_MESSAGES, REASONING_CONFIG } = await import('./config.js');
				const configInfo = {
					timestamp: new Date().toISOString(),
					deployment_version: 'v2025-11-08-02',
					model: DEEPSEEK_MODEL,
					api_url: DEEPSEEK_API_URL,
					max_context_tokens: MAX_CONTEXT_TOKENS,
					max_history_messages: MAX_HISTORY_MESSAGES,
					reasoning_config: REASONING_CONFIG,
					env_vars_set: {
						jwt_secret: !!env.JWT_SECRET,
						deepseek_api_key: !!env.DEEPSEEK_API_KEY,
						admin_secret: !!env.ADMIN_SECRET
					}
				};
				return new Response(JSON.stringify(configInfo, null, 2), {
					headers: { 'Content-Type': 'application/json' }
				});
			}
			
			// 创建上下文对象
			const context = {
				request,
				env,
				ctx,
				data: {},
			};

			// 根据路径和方法路由到相应的处理函数
			if (pathname === '/api/register' && request.method === 'POST') {
				// 注册不需要验证
				const response = await registerHandler(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
			} else if (pathname === '/api/login' && request.method === 'POST') {
				// 登录不需要验证
				const response = await loginHandler(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
			} else if (pathname === '/api/feedback' && request.method === 'POST') {
				// 反馈API - 可选验证（支持未登录用户）
				const authHeader = request.headers.get('Authorization');
				if (authHeader && authHeader.startsWith('Bearer ')) {
					const auth = await authenticateRequest(request, env);
					if (auth.success) {
						context.data.user = auth.user;
					}
				}
				const response = await submitFeedback(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime, context.data.user?.id);
			} else if (pathname === '/api/admin/login' && request.method === 'POST') {
				const response = await adminLogin(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
			} else if (pathname === '/api/chat/ws' && request.method === 'GET') {
				// WebSocket 连接需要验证
				// 从 URL 参数中获取 token（因为 WebSocket 无法设置自定义 header）
				const url = new URL(request.url);
				const token = url.searchParams.get('token');
				
				if (!token) {
					return new Response('缺少认证令牌', { status: 401 });
				}
				
				// 验证 token
				const jwtSecret = getJwtSecret(env);
				try {
					// Verify the token and get the payload
					const result = /** @type {CustomJwtPayload} */ (/** @type {unknown} */ (await jwt.verify(token, jwtSecret)));
					const payload = result.payload || result;

					// Check if payload has user id
					if (!payload.id) {
						return new Response('无效的令牌', { status: 401 });
					}
					
					// 为每个用户创建一个唯一的 Durable Object 实例
					const userId = payload.id;
					const id = env.CHAT_SESSION.idFromName(`user-${userId}`);
					const stub = env.CHAT_SESSION.get(id);
					
					// 将请求转发到 Durable Object，并附加用户 ID
					url.searchParams.set('userId', userId);
					const newRequest = new Request(url.toString(), request);
					
					return stub.fetch(newRequest);
				} catch (err) {
					// 记录WebSocket认证失败
					await logWarning(env, 'auth', 'WebSocket 连接 Token 验证失败', {
						endpoint: pathname,
						method: 'GET', // WebSocket upgrade is a GET request
						error: err,
						request
					});
					return new Response('无效的授权令牌', { status: 401 });
				}
			} else if (pathname === '/api/history' && request.method === 'GET') {
				// history 需要验证
				const auth = await authenticateRequest(request, env);
				if (!auth.success) {
					return auth.response;
				}
				context.data.user = auth.user;
				const response = await historyHandler(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime, auth.user?.id);
			} else if (pathname === '/api/admin/users' && request.method === 'GET') {
				const auth = await authenticateRequest(request, env, 'admin');
				if (!auth.success) {
					return auth.response;
				}
				context.data.admin = auth.admin;
				const response = await adminListUsers(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
			} else if (pathname === '/api/admin/registration-codes' && request.method === 'GET') {
				const auth = await authenticateRequest(request, env, 'admin');
				if (!auth.success) {
					return auth.response;
				}
				context.data.admin = auth.admin;
				const response = await listRegistrationCodes(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
			} else if (pathname === '/api/admin/registration-codes' && request.method === 'POST') {
				const auth = await authenticateRequest(request, env, 'admin');
				if (!auth.success) {
					return auth.response;
				}
				context.data.admin = auth.admin;
				const response = await createRegistrationCode(context);
				return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
			} else {
				const adminHistoryMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/history$/);
				if (adminHistoryMatch && request.method === 'GET') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await adminGetUserHistory(context, Number(adminHistoryMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				const adminExportMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/history\/export$/);
				if (adminExportMatch && request.method === 'GET') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await adminExportUserHistory(context, Number(adminExportMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				const adminUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
				if (adminUserMatch && request.method === 'DELETE') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await adminDeleteUser(context, Number(adminUserMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				const adminCodeToggleMatch = pathname.match(/^\/api\/admin\/registration-codes\/(\d+)\/toggle$/);
				if (adminCodeToggleMatch && request.method === 'POST') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await toggleRegistrationCode(context, Number(adminCodeToggleMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				const adminCodeMatch = pathname.match(/^\/api\/admin\/registration-codes\/(\d+)$/);
				if (adminCodeMatch && request.method === 'DELETE') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await deleteRegistrationCode(context, Number(adminCodeMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				const resetPasswordMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
				if (resetPasswordMatch && request.method === 'POST') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await resetUserPassword(context, Number(resetPasswordMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				// 日志管理路由
				if (pathname === '/api/admin/logs' && request.method === 'GET') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await listErrorLogs(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				if (pathname === '/api/admin/logs/stats' && request.method === 'GET') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await getLogStats(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				if (pathname === '/api/admin/logs/clear' && request.method === 'POST') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await clearOldLogs(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				const deleteLogMatch = pathname.match(/^\/api\/admin\/logs\/(\d+)$/);
				if (deleteLogMatch && request.method === 'DELETE') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await deleteErrorLog(context, Number(deleteLogMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				// 数据保留策略管理路由
				if (pathname === '/api/admin/data-retention/stats' && request.method === 'GET') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await getDataRetentionStatistics(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				if (pathname === '/api/admin/data-retention/cleanup' && request.method === 'POST') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await triggerDataRetentionCleanup(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				// 性能统计路由
				if (pathname === '/api/admin/performance/stats' && request.method === 'GET') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await getPerformanceStatistics(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				if (pathname === '/api/admin/performance/cleanup' && request.method === 'POST') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await cleanupPerformanceMetrics(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				// 清除所有数据路由
				if (pathname === '/api/admin/database/clear-all' && request.method === 'POST') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await clearAllData(context);
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				// 清除特定用户聊天记录路由
				const clearUserHistoryMatch = pathname.match(/^\/api\/admin\/user\/(\d+)\/chat-history$/);
				if (clearUserHistoryMatch && request.method === 'DELETE') {
					const auth = await authenticateRequest(request, env, 'admin');
					if (!auth.success) {
						return auth.response;
					}
					context.data.admin = auth.admin;
					const response = await clearUserChatHistory(context, Number(clearUserHistoryMatch[1]));
					return wrapApiResponse(response, env, ctx, pathname, requestStartTime);
				}

				return new Response('API 端点不存在', { status: 404 });
			}
		}

		// 自定义路由
		if (pathname === '/message') {
			return new Response('Hello, World!');
		}
		if (pathname === '/random') {
			return new Response(crypto.randomUUID());
		}

		// 其他所有请求 → 静态资产
		return env.ASSETS.fetch(request);
	},

	/**
	 * Handle scheduled cron triggers
	 * Configure in wrangler.jsonc under "triggers.crons"
	 */
	async scheduled(event, env, ctx) {
		await handleScheduled(event, env, ctx);
	}
};

/**
 * @typedef {import('@tsndr/cloudflare-worker-jwt').JwtPayload & { id: string; role: 'user' | 'admin' }} CustomJwtPayload
 */
