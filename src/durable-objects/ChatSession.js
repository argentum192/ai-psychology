/**
 * ChatSession Durable Object
 * 
 * 每个用户的聊天会话由一个独立的 Durable Object 实例管理
 * 使用 WebSocket 实现实时双向通信，极大降低流式传输的成本
 */

import { 
  DEEPSEEK_MODEL, 
  DEEPSEEK_API_URL,
  MAX_CONTEXT_TOKENS,
  RESERVED_TOKENS,
  MAX_HISTORY_MESSAGES,
  SYSTEM_PROMPT_TEMPLATE,
  REASONING_CONFIG,
  MESSAGE_RATE_LIMIT,
  MAX_MESSAGE_LENGTH,
  getDeepSeekApiKey
} from '../config.js';
import { logError, logWarning, debugLog } from '../utils/logger.js';
import { trackWebSocketConnection, trackAiApiCall, trackTokenUsage } from '../utils/performanceTracker.js';

export class ChatSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.websockets = new Set(); // 改为 Set 来支持多个连接
    this.userId = null;
    // 速率限制：记录最近的消息时间戳
    this.messageTimestamps = [];
    // WebSocket 连接统计
    this.connectionStats = new Map(); // 记录每个连接的开始时间
    // 消息处理队列和锁
    this.isProcessingMessage = false;
    this.messageQueue = [];
    // 当前处理任务的中止控制器
    this.currentAbortController = null;
    // 服务器端心跳定时器
    this.heartbeatInterval = null;
  }

  /**
   * 保存聊天消息到数据库
   * @param {string} sender - 'user' 或 'ai'
   * @param {string} message - 消息内容
   */
  async saveChatMessage(sender, message) {
    if (!this.userId || typeof this.userId !== 'number') {
      throw new Error(`Invalid userId: ${this.userId}`);
    }
    
    await this.env.ai_psychology_db.prepare(
      "INSERT INTO chat_logs (user_id, sender, message) VALUES (?, ?, ?)"
    ).bind(this.userId, sender, message).run();
  }

  /**
   * 发送错误消息给客户端并记录日志
   * @param {string} message - 错误消息
   * @param {Error} error - 错误对象（可选）
   * @param {string} category - 错误类别
   */
  async sendError(message, error = null, category = 'chat') {
    this.sendToClient({ 
      type: 'error', 
      message 
    });
    
    if (error) {
      await logError(this.env, {
        level: 'error',
        category,
        message,
        error,
        userId: this.userId,
        endpoint: 'ChatSession'
      });
    }
  }

  /**
   * 初始化会话
   */
  async initializeSession() {
    // 尝试从持久化存储中恢复 userId
    if (!this.userId) {
      const storedUserId = await this.state.storage.get('userId');
      if (storedUserId) {
        this.userId = storedUserId;
      }
    }
  }

  /**
   * 获取或加载历史记录
   */
  async getHistory() {
    const historyResult = await this.env.ai_psychology_db.prepare(
      "SELECT sender, message FROM chat_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).bind(this.userId, MAX_HISTORY_MESSAGES).all();
    
    const history = historyResult.results.reverse().map(log => ({
      role: log.sender === 'user' ? 'user' : 'assistant',
      content: log.message
    }));

    return history;
  }

  /**
   * 处理 HTTP 请求（WebSocket 握手）
   */
  async fetch(request) {
    // 检查是否是 WebSocket 升级请求
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // 从 URL 参数获取用户 ID（由主 Worker 在认证后传递）
    const url = new URL(request.url);
    const userIdParam = url.searchParams.get('userId');
    
    if (!userIdParam) {
      return new Response('Missing userId', { status: 400 });
    }
    
    // 转换为整数并验证
    this.userId = parseInt(userIdParam, 10);
    if (isNaN(this.userId)) {
      return new Response('Invalid userId', { status: 400 });
    }

    // 持久化 userId 到存储中，以便在 WebSocket 重连时恢复
    await this.state.storage.put('userId', this.userId);

    // 初始化会话（加载缓存）
    await this.initializeSession();

    // 创建 WebSocket 对
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // 接受 WebSocket 连接
    this.state.acceptWebSocket(server);
    this.websockets.add(server);
    // 记录连接开始时间
    this.connectionStats.set(server, Date.now());

    // 启动服务器端心跳（如果尚未启动）
    this.startServerHeartbeat();

    // 新连接建立时，检查并恢复处理状态
    // 如果有等待处理的消息队列且当前没在处理，启动处理
    if (this.messageQueue.length > 0 && !this.isProcessingMessage) {
      // 使用 Promise 异步处理，避免阻塞响应
      this.processMessageQueue().catch(error => {
        logError(this.env, {
          level: 'error',
          category: 'websocket',
          message: '恢复消息队列处理失败',
          error,
          userId: this.userId
        });
      });
    }

    // 返回客户端 WebSocket
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * 处理消息队列
   */
  async processMessageQueue() {
    // 防止并发处理：如果已经在处理，直接返回
    if (this.isProcessingMessage) {
      return;
    }
    
    // 关键修复：如果没有活动连接，不要启动处理
    if (this.websockets.size === 0) {
      return;
    }
    
    this.isProcessingMessage = true;
    
    try {
      while (this.messageQueue.length > 0) {
        const userMessage = this.messageQueue.shift();
        
        // 检查是否还有活动的 WebSocket 连接
        if (this.websockets.size === 0) {
          // 将消息放回队列，等待新连接
          this.messageQueue.unshift(userMessage);
          break;
        }
        
        try {
          await this.handleChatMessage(userMessage);
        } catch (error) {
          // 如果是中止错误，说明连接已断开，停止处理队列
          if (error.name === 'AbortError') {
            // 将消息放回队列，等待新连接
            this.messageQueue.unshift(userMessage);
            break;
          }
          
          // 其他错误，记录日志并继续处理下一条消息
          await logError(this.env, {
            level: 'error',
            category: 'chat',
            message: '处理队列消息失败',
            error,
            userId: this.userId
          });
          this.sendToClient({ 
            type: 'error', 
            message: '消息处理失败，请重试' 
          });
        }
      }
    } finally {
      // 确保无论如何都会重置标志
      this.isProcessingMessage = false;
      
      // 🔥 关键修复：只有在有活动连接时才继续处理
      if (this.messageQueue.length > 0 && this.websockets.size > 0) {
        // 异步触发，避免深度递归
        Promise.resolve().then(() => this.processMessageQueue().catch(error => {
          logError(this.env, {
            level: 'error',
            category: 'chat',
            message: '继续处理消息队列失败',
            error,
            userId: this.userId
          });
        }));
      }
    }
  }

  /**
   * 检查速率限制
   * @returns {boolean} 是否允许发送消息
   */
  checkRateLimit() {
    const now = Date.now();
    // 移除时间窗口外的旧时间戳
    this.messageTimestamps = this.messageTimestamps.filter(
      timestamp => now - timestamp < MESSAGE_RATE_LIMIT.TIME_WINDOW
    );
    
    // 检查是否超过限制
    if (this.messageTimestamps.length >= MESSAGE_RATE_LIMIT.MAX_MESSAGES) {
      return false;
    }
    
    // 记录当前消息时间戳
    this.messageTimestamps.push(now);
    return true;
  }

  /**
   * 处理聊天消息并调用 AI
   */
  async handleChatMessage(userMessage) {
    if (!userMessage || !userMessage.trim()) {
      this.sendToClient({ type: 'error', message: '消息内容不能为空' });
      return;
    }

    // 检查消息长度
    if (userMessage.length > MAX_MESSAGE_LENGTH) {
      this.sendToClient({ 
        type: 'error', 
        message: `消息长度不能超过 ${MAX_MESSAGE_LENGTH} 个字符（当前 ${userMessage.length} 字符）` 
      });
      return;
    }

    // 检查速率限制
    if (!this.checkRateLimit()) {
      const remainingTime = Math.ceil(MESSAGE_RATE_LIMIT.TIME_WINDOW / 1000);
      this.sendToClient({ 
        type: 'error', 
        message: `发送消息过于频繁，请在 ${remainingTime} 秒后重试` 
      });
      return;
    }

    try {
      // 验证 user_id 是否有效
      if (!this.userId || typeof this.userId !== 'number') {
        await this.sendError(
          '会话状态异常，请刷新页面重试',
          new Error(`Invalid userId: ${this.userId}`),
          'chat'
        );
        return;
      }

      // 将用户消息存入数据库
      try {
        await this.saveChatMessage('user', userMessage);
      } catch (dbError) {
        await this.sendError(
          '消息保存失败，请稍后重试',
          dbError,
          'database'
        );
        return;
      }

      // 通知客户端消息已接收
      this.sendToClient({ type: 'message_received', content: userMessage });

      // 3. 准备系统提示词
      const now = new Date();
      const beijingDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const options = { 
        timeZone: 'UTC',
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit'
      };
      // @ts-ignore - TypeScript 类型定义不够精确
      const currentTime = beijingDate.toLocaleString('zh-CN', options);
      const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{currentTime}', currentTime);

      // 4. Token 估算
      const estimateTokens = (text) => {
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const otherChars = text.length - chineseChars;
        return chineseChars + Math.ceil(otherChars / 4);
      };

      const SYSTEM_PROMPT_TOKENS = estimateTokens(systemPrompt);
      const CURRENT_MESSAGE_TOKENS = estimateTokens(userMessage);
      const AVAILABLE_TOKENS = MAX_CONTEXT_TOKENS - SYSTEM_PROMPT_TOKENS - CURRENT_MESSAGE_TOKENS - RESERVED_TOKENS;

      // 5. 获取历史记录（使用缓存）
      const allHistory = await this.getHistory();

      // 动态截断历史记录以适应 token 限制
      const formattedHistory = [];
      let currentTokenCount = 0;
      
      for (let i = allHistory.length - 1; i >= 0; i--) {
        const msgTokens = estimateTokens(allHistory[i].content);
        if (currentTokenCount + msgTokens <= AVAILABLE_TOKENS) {
          formattedHistory.unshift(allHistory[i]);
          currentTokenCount += msgTokens;
        } else {
          break;
        }
      }

      // 6. 调用 AI API（流式）
      const apiKey = getDeepSeekApiKey(this.env);
      
      // 创建中止控制器
      this.currentAbortController = new AbortController();
      
      // 准备请求体
      const requestBody = {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: userMessage }
        ],
        stream: true,
        ...(DEEPSEEK_MODEL === 'deepseek-reasoner' && {
          reasoning_options: {
            max_tokens: REASONING_CONFIG.max_tokens
          }
        })
      };
      
      // 记录 AI API 调用开始时间
      const aiApiStartTime = Date.now();
      
      // 添加超时保护：30秒超时（给 Cloudflare Worker 留一些余地）
      const fetchTimeout = 25000; // 25秒超时
      const timeoutId = setTimeout(() => {
        if (this.currentAbortController) {
          this.currentAbortController.abort();
        }
      }, fetchTimeout);
      
      let aiResponse;
      try {
        aiResponse = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: this.currentAbortController.signal
        });
      } finally {
        clearTimeout(timeoutId); // 清除超时定时器
      }

      
      // 记录 AI API 调用延迟（从请求到响应头）
      const aiApiDuration = Date.now() - aiApiStartTime;
      await trackAiApiCall(this.env, aiApiDuration, this.userId);

      if (!aiResponse.ok) {
        // 清除中止控制器
        this.currentAbortController = null;
        
        const errorText = await aiResponse.text();
        await this.sendError(
          `调用 AI 服务失败: ${aiResponse.status}`,
          new Error(errorText),
          'ai_api'
        );
        
        // 重要：即使失败也要发送 ai_complete，让前端解锁
        this.sendToClient({ type: 'ai_complete', fullContent: '' });
        return;
      }

      // 7. 处理流式响应（传递用户消息以便缓存）
      await this.streamAIResponse(aiResponse, userMessage);

    } catch (error) {
      // 清除中止控制器
      this.currentAbortController = null;
      
      // 如果是中止错误，重新抛出让 processMessageQueue 处理
      if (error.name === 'AbortError') {
        throw error; // 重新抛出，让队列处理器知道需要暂停
      }
      
      await this.sendError('服务器内部错误', error, 'chat');
    }
  }

  /**
   * 处理 AI 流式响应并实时发送给客户端
   * @param {Response} aiResponse - AI API 的响应
   * @param {string} userMessage - 用户的原始消息（用于缓存）
   */
  async streamAIResponse(aiResponse, userMessage) {
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    
    let fullResponse = '';
    let sseBuffer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let chunkCount = 0;

    try {
      // 通知客户端开始接收 AI 响应
      this.sendToClient({ type: 'ai_start' });

      while (true) {
        // 检查是否还有活动的 WebSocket 连接
        if (this.websockets.size === 0) {
          try {
            await reader.cancel();
          } catch (e) {
            // 忽略 cancel 错误
          }
          // 抛出 AbortError，让上层知道处理被中止
          const abortError = new Error('Stream aborted due to no active connections');
          abortError.name = 'AbortError';
          throw abortError;
        }
        
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const content = line.substring(6).trim();
            if (content === '[DONE]') {
              break;
            }
            
            try {
              const data = JSON.parse(content);
              if (data.choices?.[0]?.delta?.content) {
                const deltaContent = data.choices[0].delta.content;
                fullResponse += deltaContent;
                chunkCount++;
                
                // 实时发送每个 token/片段给客户端
                // 由于 WebSocket，每条消息的成本极低
                this.sendToClient({ 
                  type: 'ai_chunk', 
                  content: deltaContent 
                });
              }
              
              // 提取 Token 使用量信息
              if (data.usage) {
                promptTokens = data.usage.prompt_tokens || 0;
                completionTokens = data.usage.completion_tokens || 0;
                totalTokens = data.usage.total_tokens || 0;
              }
            } catch (e) {
              // 忽略无法解析的行
            }
          }
        }
      }

      // 清除中止控制器
      this.currentAbortController = null;

      // 8. 将完整响应保存到数据库
      if (fullResponse && fullResponse.trim()) {
        try {
          await this.saveChatMessage('ai', fullResponse);
        } catch (dbError) {
          await logError(this.env, {
            level: 'error',
            category: 'database',
            message: '保存 AI 响应到数据库失败',
            error: dbError,
            userId: this.userId,
            endpoint: 'ChatSession.streamAIResponse'
          });
          // 即使保存失败，也继续发送给客户端
          // 但通知用户消息未保存
          this.sendToClient({
            type: 'warning',
            message: '消息接收成功但未能保存到历史记录'
          });
        }
        
        // 9. 记录 Token 使用量
        if (totalTokens > 0) {
          await trackTokenUsage(
            this.env, 
            totalTokens, 
            promptTokens, 
            completionTokens, 
            this.userId
          );
        }
      } else {
        // AI 返回了空响应，记录警告
        await logWarning(this.env, 'chat', `AI 返回空响应，用户消息: ${userMessage.substring(0, 50)}`);
      }

      // 通知客户端 AI 响应完成（即使响应为空也要通知）
      this.sendToClient({ 
        type: 'ai_complete', 
        fullContent: fullResponse 
      });

    } catch (error) {
      // 清除中止控制器
      this.currentAbortController = null;
      
      // 如果是中止错误，不记录为错误（这是正常的用户行为）
      if (error.name === 'AbortError') {
        // 不发送错误消息给客户端，因为可能已经没有连接了
        return;
      }
      
      await logError(this.env, {
        level: 'error',
        category: 'chat',
        message: 'AI流读取错误',
        error,
        userId: this.userId
      });
      this.sendToClient({ 
        type: 'error', 
        message: '流读取失败，请重试' 
      });
      
      // 重要：即使失败也要发送 ai_complete，让前端解锁
      this.sendToClient({ 
        type: 'ai_complete', 
        fullContent: '' 
      });
    }
  }

  /**
   * 向客户端发送消息（广播到所有连接）
   */
  sendToClient(message) {
    const messageStr = JSON.stringify(message);
    // 向所有连接的客户端广播消息
    for (const ws of this.websockets) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(messageStr);
        } catch (error) {
          // 如果发送失败，从集合中移除这个连接
          this.websockets.delete(ws);
        }
      }
    }
  }

  /**
   * WebSocket 消息处理（Durable Object 生命周期方法）
   */
  async webSocketMessage(ws, message) {
    try {
      // 如果 userId 未设置，尝试从存储中恢复
      if (!this.userId) {
        await this.initializeSession();
      }

      // 如果仍然没有 userId，返回错误
      if (!this.userId) {
        await logError(this.env, {
          level: 'error',
          category: 'websocket',
          message: 'webSocketMessage 被调用但 userId 未初始化',
          error: new Error('Missing userId in webSocketMessage'),
          userId: null
        });
        this.sendToClient({ 
          type: 'error', 
          message: '会话已过期，请刷新页面重新连接' 
        });
        return;
      }

      const msg = JSON.parse(message);
      
      switch (msg.type) {
        case 'chat':
          // 将消息加入队列
          this.messageQueue.push(msg.content);
          
          // 触发队列处理（不使用 await，避免阻塞）
          this.processMessageQueue().catch(error => {
            logError(this.env, {
              level: 'error',
              category: 'chat',
              message: '启动消息队列处理失败',
              error,
              userId: this.userId
            });
          });
          break;
        case 'ping':
          this.sendToClient({ type: 'pong' });
          break;
        default:
          this.sendToClient({ 
            type: 'error', 
            message: '未知的消息类型' 
          });
      }
    } catch (error) {
      await logError(this.env, {
        level: 'error',
        category: 'websocket',
        message: '处理消息失败',
        error,
        userId: this.userId
      });
      this.sendToClient({ 
        type: 'error', 
        message: '处理消息失败: ' + error.message 
      });
    }
  }

  /**
   * 启动服务器端心跳
   * 定期向所有客户端发送心跳，保持连接活跃
   */
  startServerHeartbeat() {
    // 如果已经有心跳定时器，先清除
    if (this.heartbeatInterval) {
      return;
    }
    
    // 每 20 秒发送一次心跳
    this.heartbeatInterval = setInterval(() => {
      if (this.websockets.size > 0) {
        this.sendToClient({ type: 'heartbeat', timestamp: Date.now() });
      } else {
        // 如果没有连接了，停止心跳
        this.stopServerHeartbeat();
      }
    }, 20000); // 20 秒
  }

  /**
   * 停止服务器端心跳
   */
  stopServerHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * WebSocket 关闭处理
   */
  async webSocketClose(ws, code, reason, wasClean) {
    // 记录连接时长
    const startTime = this.connectionStats.get(ws);
    if (startTime && this.userId) {
      const duration = Date.now() - startTime;
      try {
        await trackWebSocketConnection(this.env, duration, this.userId);
      } catch (error) {
        // 忽略记录失败
      }
      this.connectionStats.delete(ws);
    }
    
    this.websockets.delete(ws);
    
    // 如果没有活动的 WebSocket 连接了，停止心跳
    if (this.websockets.size === 0) {
      this.stopServerHeartbeat();
      
      // 如果正在处理消息，中止当前请求
      if (this.isProcessingMessage && this.currentAbortController) {
        this.currentAbortController.abort();
        this.currentAbortController = null;
      }
    }
  }

  /**
   * WebSocket 错误处理
   */
  async webSocketError(ws, error) {
    await logWarning(this.env, 'websocket', `WebSocket 错误: userId=${this.userId}`);
    
    // 记录连接时长（即使出错）
    const startTime = this.connectionStats.get(ws);
    if (startTime && this.userId) {
      const duration = Date.now() - startTime;
      try {
        await trackWebSocketConnection(this.env, duration, this.userId);
      } catch (err) {
        // 忽略记录失败
      }
      this.connectionStats.delete(ws);
    }
  }
}