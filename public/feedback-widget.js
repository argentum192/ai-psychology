/**
 * Bug反馈组件
 * 在页面中添加浮动的反馈按钮，用户可以快速提交bug或问题
 */

// @ts-ignore - APP_CONFIG 可能在其他文件中定义
/* global APP_CONFIG */

// 创建反馈按钮和弹窗的HTML
function createFeedbackWidget() {
    const widgetHTML = `
        <!-- Bug反馈按钮 -->
        <button id="feedback-btn" class="feedback-btn" title="报告问题或反馈">
            🐛
        </button>

        <!-- 反馈弹窗 -->
        <div id="feedback-modal" class="feedback-modal">
            <div class="feedback-modal-content">
                <div class="feedback-modal-header">
                    <h3>问题反馈</h3>
                    <button id="feedback-close" class="feedback-close">&times;</button>
                </div>
                <div class="feedback-modal-body">
                    <div class="feedback-form-group">
                        <label>反馈类型</label>
                        <select id="feedback-type">
                            <option value="bug">🐛 Bug / 错误</option>
                            <option value="suggestion">💡 建议</option>
                            <option value="question">❓ 问题</option>
                            <option value="other">📝 其他</option>
                        </select>
                    </div>
                    <div class="feedback-form-group">
                        <label>详细描述</label>
                        <textarea id="feedback-message" rows="5" placeholder="请详细描述您遇到的问题或建议..."></textarea>
                    </div>
                    <div id="feedback-result" class="feedback-result"></div>
                </div>
                <div class="feedback-modal-footer">
                    <button id="feedback-cancel" class="feedback-btn-secondary">取消</button>
                    <button id="feedback-submit" class="feedback-btn-primary">提交反馈</button>
                </div>
            </div>
        </div>

        <style>
            .feedback-btn {
                position: fixed;
                bottom: 30px;
                right: 30px;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                transition: all 0.3s ease;
                z-index: 999;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .feedback-btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            }

            .feedback-btn:active {
                transform: translateY(-1px);
            }

            .feedback-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 1000;
                align-items: center;
                justify-content: center;
            }

            .feedback-modal.active {
                display: flex;
            }

            .feedback-modal-content {
                background: white;
                border-radius: 16px;
                width: 90%;
                max-width: 500px;
                max-height: 90vh;
                overflow: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: feedbackSlideIn 0.3s ease;
            }

            @keyframes feedbackSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .feedback-modal-header {
                padding: 20px;
                border-bottom: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .feedback-modal-header h3 {
                margin: 0;
                font-size: 20px;
                color: #1f2937;
            }

            .feedback-close {
                background: none;
                border: none;
                font-size: 28px;
                color: #9ca3af;
                cursor: pointer;
                padding: 0;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s;
            }

            .feedback-close:hover {
                background: #f3f4f6;
                color: #1f2937;
            }

            .feedback-modal-body {
                padding: 20px;
            }

            .feedback-form-group {
                margin-bottom: 16px;
            }

            .feedback-form-group label {
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
                color: #374151;
                font-size: 14px;
            }

            .feedback-form-group select,
            .feedback-form-group textarea {
                width: 100%;
                padding: 10px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                font-size: 14px;
                font-family: inherit;
                transition: border-color 0.2s;
            }

            .feedback-form-group select:focus,
            .feedback-form-group textarea:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }

            .feedback-form-group textarea {
                resize: vertical;
                min-height: 100px;
            }

            .feedback-result {
                padding: 12px;
                border-radius: 8px;
                margin-top: 12px;
                display: none;
                font-size: 14px;
            }

            .feedback-result.success {
                display: block;
                background: #d1fae5;
                color: #065f46;
                border: 1px solid #6ee7b7;
            }

            .feedback-result.error {
                display: block;
                background: #fee2e2;
                color: #991b1b;
                border: 1px solid #fca5a5;
            }

            .feedback-modal-footer {
                padding: 20px;
                border-top: 1px solid #e2e8f0;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .feedback-btn-primary,
            .feedback-btn-secondary {
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                border: none;
                transition: all 0.2s;
            }

            .feedback-btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }

            .feedback-btn-primary:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }

            .feedback-btn-primary:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }

            .feedback-btn-secondary {
                background: #f3f4f6;
                color: #374151;
            }

            .feedback-btn-secondary:hover {
                background: #e5e7eb;
            }

            @media (max-width: 640px) {
                .feedback-btn {
                    bottom: 90px; /* 提高位置，避免遮挡输入框区域 */
                    right: 20px;
                    width: 48px;
                    height: 48px;
                    font-size: 20px;
                }

                .feedback-modal-content {
                    width: 95%;
                    margin: 10px;
                }
            }
            
            /* 针对移动端聊天页面的额外优化 */
            @media (max-width: 768px) {
                .feedback-btn {
                    bottom: 90px; /* 避免遮挡输入框和发送按钮 */
                    right: 15px;
                }
            }
        </style>
    `;

    // 插入到页面
    document.body.insertAdjacentHTML('beforeend', widgetHTML);
}

// 初始化反馈功能
function initFeedbackWidget() {
    // 创建组件
    createFeedbackWidget();

    // 获取元素
    const feedbackBtn = /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (document.getElementById('feedback-btn')));
    const feedbackModal = /** @type {HTMLDivElement} */ (/** @type {unknown} */ (document.getElementById('feedback-modal')));
    const feedbackClose = /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (document.getElementById('feedback-close')));
    const feedbackCancel = /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (document.getElementById('feedback-cancel')));
    const feedbackSubmit = /** @type {HTMLButtonElement} */ (/** @type {unknown} */ (document.getElementById('feedback-submit')));
    const feedbackType = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (document.getElementById('feedback-type')));
    const feedbackMessage = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ (document.getElementById('feedback-message')));
    const feedbackResult = /** @type {HTMLDivElement} */ (/** @type {unknown} */ (document.getElementById('feedback-result')));

    // 打开弹窗
    feedbackBtn.addEventListener('click', () => {
        feedbackModal.classList.add('active');
        feedbackMessage.focus();
    });

    // 关闭弹窗
    const closeModal = () => {
        feedbackModal.classList.remove('active');
        feedbackResult.className = 'feedback-result';
        feedbackResult.textContent = '';
    };

    feedbackClose.addEventListener('click', closeModal);
    feedbackCancel.addEventListener('click', closeModal);

    // 点击背景关闭
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeModal();
        }
    });

    // 提交反馈
    feedbackSubmit.addEventListener('click', async () => {
        const type = feedbackType.value;
        const message = feedbackMessage.value.trim();

        if (!message) {
            feedbackResult.className = 'feedback-result error';
            feedbackResult.textContent = '请输入反馈内容';
            return;
        }

        // 禁用提交按钮
        feedbackSubmit.disabled = true;
        feedbackSubmit.textContent = '提交中...';

        try {
            // 获取当前页面信息
            const feedbackData = {
                type,
                message,
                url: window.location.href,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString()
            };

            // 尝试获取token（如果用户已登录）
            // @ts-ignore - APP_CONFIG 可能在其他文件中定义
            const token = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.auth.getToken() : localStorage.getItem('token');
            
            const headers = {
                'Content-Type': 'application/json'
            };

            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers,
                body: JSON.stringify(feedbackData)
            });

            const result = await response.json();

            if (result.success) {
                feedbackResult.className = 'feedback-result success';
                feedbackResult.textContent = '✓ ' + result.message;
                feedbackMessage.value = '';
                
                // 3秒后关闭弹窗
                setTimeout(closeModal, 3000);
            } else {
                feedbackResult.className = 'feedback-result error';
                feedbackResult.textContent = '✗ ' + result.message;
            }
        } catch (error) {
            console.error('提交反馈失败:', error);
            feedbackResult.className = 'feedback-result error';
            feedbackResult.textContent = '✗ 提交失败，请稍后重试';
        } finally {
            feedbackSubmit.disabled = false;
            feedbackSubmit.textContent = '提交反馈';
        }
    });

    // 按ESC关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && feedbackModal.classList.contains('active')) {
            closeModal();
        }
    });
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeedbackWidget);
} else {
    initFeedbackWidget();
}
