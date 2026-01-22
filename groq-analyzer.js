/**
 * Groq LPU Integration Module
 * 
 * Provides natural language processing and AI-powered portfolio analysis
 * using Groq's Language Processing Unit for ultra-fast responses.
 * 
 * Key Features:
 * - Natural language portfolio queries
 * - Risk assessment and analysis
 * - Strategy recommendations with reasoning
 * - Conversational DeFi insights
 */

const Groq = require('groq-sdk');

class GroqAnalyzer {
    constructor(apiKey, logger = console) {
        this.logger = logger;
        
        // Enhanced API key validation
        if (!apiKey) {
            throw new Error('GROQ_API_KEY is required');
        }
        
        if (typeof apiKey !== 'string') {
            throw new Error('GROQ_API_KEY must be a string');
        }
        
        if (apiKey.length < 10) {
            throw new Error('GROQ_API_KEY appears to be invalid (too short)');
        }
        
        // Log API key status (masked for security)
        this.logger.info('Groq API Key validation', {
            hasKey: !!apiKey,
            keyLength: apiKey.length,
            keyPreview: apiKey.substring(0, 8) + '...',
            keyType: typeof apiKey
        });
        
        try {
            this.groq = new Groq({
                apiKey: apiKey,
                timeout: 30000, // Increased timeout for Railway network
                dangerouslyAllowBrowser: false,
                maxRetries: 0 // We handle retries manually
            });
            
            this.logger.info('Groq client initialized successfully', {
                timeout: 30000,
                hasClient: !!this.groq
            });
        } catch (error) {
            this.logger.error('Groq client initialization failed:', {
                error: error.message,
                stack: error.stack,
                apiKeyLength: apiKey?.length
            });
            this.groq = null;
        }
        
        // Available models optimized for different tasks (Updated Oct 2025)
        this.models = {
            fast: 'llama-3.1-8b-instant',      // Fast responses, good for simple queries
            balanced: 'llama-3.3-70b-versatile',  // Balance of speed and intelligence
            smart: 'llama-3.3-70b-versatile'   // Most intelligent, larger context
        };
        
        this.defaultModel = this.models.fast;
    }

    /**
     * Process a natural language query about user's portfolio
     * 
     * @param {string} userQuestion - User's question in natural language
     * @param {Object} portfolioData - Portfolio data from AURA API
     * @param {Object} strategiesData - Strategies data from AURA API
     * @param {string} modelType - 'fast', 'balanced', or 'smart'
     * @returns {Promise<string>} AI-generated response
     */
    async analyzePortfolioQuery(query, portfolioData) {
        if (!this.groq) {
            this.logger.warn('Groq client not initialized');
            throw new Error('AI analysis service is currently unavailable. Please ensure GROQ_API_KEY is configured properly.');
        }

        // Trim portfolio data to keep prompt size small and avoid token limits
        const summarized = this._summarizePortfolio(portfolioData);

        const maxRetries = 3;
    const baseDelay = 2000;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.info('Groq API attempt', {
                    attempt,
                    maxRetries,
                    modelType: 'balanced'
                });

                const prompt = `As a professional DeFi portfolio advisor, analyze this client inquiry and provide expert guidance:

**Client Query:** "${query}"

**Portfolio Summary (trimmed):** ${JSON.stringify(summarized, null, 2)}

**Required Response Format:**
1. **Direct Professional Response** to the client's specific question
2. **Portfolio Assessment** with relevant insights and metrics
3. **Strategic Recommendations** with clear rationale
4. **Risk Considerations** where applicable

**Professional Guidelines:**
- Maintain formal, advisory tone throughout
- Provide specific, actionable recommendations
- Include relevant market context when appropriate
- Keep response concise yet comprehensive (under 3500 characters)
- Use professional financial terminology appropriately
- Focus on risk-adjusted portfolio optimization

**Response Tone:** Professional financial advisor providing personalized portfolio guidance to a sophisticated investor.`;

                const response = await this.groq.chat.completions.create({
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a senior DeFi portfolio advisor with extensive experience in cryptocurrency markets and decentralized finance protocols. Provide professional, institutional-grade advice with appropriate financial terminology. Maintain a formal yet accessible tone suitable for sophisticated investors seeking strategic portfolio guidance.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    model: this.models.balanced,
                    temperature: 0.6,
                    max_tokens: 1000
                });

                const result = response.choices[0]?.message?.content;
                
                if (result) {
                    this.logger.info('Natural language query processed', {
                        query,
                        responseLength: result.length,
                        userId: portfolioData.userId
                    });
                    return result;
                }

                throw new Error('No response from Groq API');

            } catch (error) {
                lastError = error;
                
                // Enhanced error classification
                const isConnectionError = error.message?.includes('timeout') || 
                                        error.message?.includes('network') ||
                                        error.message?.includes('ENOTFOUND') ||
                                        error.message?.includes('ECONNREFUSED') ||
                                        error.message?.includes('Connection error') ||
                                        error.message?.includes('ETIMEDOUT') ||
                                        error.message?.includes('socket hang up') ||
                                        error.code === 'ECONNREFUSED' ||
                                        error.code === 'ENOTFOUND' ||
                                        error.code === 'ETIMEDOUT';

                const isAuthError = error.message?.includes('401') || 
                                  error.message?.includes('unauthorized') ||
                                  error.message?.includes('invalid api key') ||
                                  error.message?.includes('authentication');

                const isRateLimitError = error.message?.includes('429') || 
                                       error.message?.includes('rate limit') ||
                                       error.message?.includes('too many requests');

                this.logger.error(`Groq attempt ${attempt}/${maxRetries} failed:`, {
                    attempt,
                    error: error.message,
                    errorCode: error.code,
                    isConnectionError,
                    isAuthError,
                    isRateLimitError,
                    maxRetries,
                    stack: error.stack?.split('\n')[0] // First line of stack trace
                });

                // Don't retry auth errors - they won't succeed
                if (isAuthError) {
                    this.logger.error('Authentication error - check GROQ_API_KEY', {
                        error: error.message,
                        suggestion: 'Verify GROQ_API_KEY is correct in Railway environment variables'
                    });
                    break;
                }

                if (attempt === maxRetries) {
                    // All retries exhausted
                    break;
                }

                // Longer delays for connection issues
                const baseRetryDelay = isConnectionError ? 2000 : 1000;
                const delay = baseRetryDelay * Math.pow(2, attempt - 1);
                
                this.logger.info('Retrying Groq request...', {
                    attempt: attempt + 1,
                    delay,
                    maxRetries,
                    errorType: isConnectionError ? 'connection' : isRateLimitError ? 'rate-limit' : 'other'
                });

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // All retries failed - throw error instead of fallback
        this.logger.error('All Groq retry attempts failed', { 
            error: lastError?.message || 'Unknown error',
            totalAttempts: maxRetries,
            question: query
        });

        throw new Error(`Unable to analyze your portfolio query at this time. Please check your connection and try again later.`);
    }

    /**
     * Create a compact summary of the portfolio to reduce prompt size
     * @private
     */
    _summarizePortfolio(data = {}) {
        try {
            const summary = {
                totalValueUSD: 0,
                networks: [],
                topTokens: []
            };
            const tokens = [];
            const nets = Array.isArray(data.portfolio) ? data.portfolio : [];
            for (const net of nets) {
                const nname = net?.network?.name || net?.network || 'Unknown';
                summary.networks.push(nname);
                const tks = Array.isArray(net.tokens) ? net.tokens : [];
                for (const t of tks) {
                    const usd = Number(t.balanceUSD || 0);
                    summary.totalValueUSD += usd;
                    if (usd > 0.01) {
                        tokens.push({
                            symbol: t.symbol || t.name || 'Unknown',
                            network: nname,
                            usd
                        });
                    }
                }
            }
            tokens.sort((a, b) => b.usd - a.usd);
            summary.topTokens = tokens.slice(0, 30); // cap at 30 tokens
            // Deduplicate networks
            summary.networks = Array.from(new Set(summary.networks));
            return summary;
        } catch (e) {
            this.logger.warn('Failed to summarize portfolio, using minimal fields', { error: e.message });
            return { note: 'summary_failed', totalValueUSD: data?.totalValue || 0 };
        }
    }

    /**
     * Analyze risk profile of the portfolio
     * 
     * @param {Object} portfolioData - Portfolio data from AURA API
     * @param {Object} strategiesData - Strategies data from AURA API
     * @returns {Promise<Object>} Risk analysis with score and recommendations
     */
    async analyzeRisk(portfolioData, strategiesData) {
        try {
            const prompt = `
Analyze the risk profile of this DeFi portfolio. Provide:
1. Overall risk score (0-100, where 0 is safest)
2. Top 3 risk factors
3. Top 3 risky assets (if any)
4. Recommended low-risk strategies from the provided list

Portfolio Data:
${JSON.stringify(portfolioData, null, 2)}

Available Strategies:
${JSON.stringify(strategiesData, null, 2)}

Format your response as JSON with this structure:
{
    "riskScore": 45,
    "riskLevel": "Moderate",
    "riskFactors": ["High concentration in volatile tokens", "Exposure to new protocols", "..."],
    "riskyAssets": [
        {"symbol": "TOKEN", "reason": "High volatility", "value": "$1000"}
    ],
    "lowRiskStrategies": [
        {"name": "Strategy Name", "reason": "Why it's low risk"}
    ],
    "summary": "One paragraph summary"
}`;

            const response = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a risk assessment expert. Analyze DeFi portfolios and return valid JSON only.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                model: this.models.smart,
                temperature: 0.3,
                max_tokens: 1500,
                response_format: { type: 'json_object' }
            });

            const riskAnalysis = JSON.parse(response.choices[0]?.message?.content || '{}');
            
            this.logger.info('Risk analysis completed', {
                riskScore: riskAnalysis.riskScore,
                riskLevel: riskAnalysis.riskLevel
            });

            return riskAnalysis;

        } catch (error) {
            this.logger.error('Risk analysis failed', { error: error.message });
            throw new Error('Unable to perform risk analysis. Please try again.');
        }
    }

    /**
     * Compare multiple strategies and provide recommendation
     * 
     * @param {Array} strategies - Array of strategy objects from AURA
     * @param {Object} portfolioData - Portfolio data for context
     * @param {string} userPreference - User's preference (e.g., "low risk", "high yield")
     * @returns {Promise<string>} Comparison and recommendation
     */
    async compareStrategies(strategies, portfolioData, userPreference = '') {
        try {
            const prompt = `
Compare these DeFi strategies and recommend the best option.

User's Portfolio Value: $${portfolioData.totalValue || 'unknown'}
User's Preference: ${userPreference || 'balanced risk/reward'}

Strategies to Compare:
${JSON.stringify(strategies, null, 2)}

Provide:
1. Brief comparison highlighting key differences
2. Recommended strategy with clear reasoning
3. Risks to be aware of
4. Expected outcomes

Keep response concise and actionable for Telegram.`;

            const response = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a DeFi strategy advisor. Compare options clearly and recommend the best fit.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                model: this.models.balanced,
                temperature: 0.6,
                max_tokens: 1500
            });

            return response.choices[0]?.message?.content || "Unable to compare strategies.";

        } catch (error) {
            this.logger.error('Strategy comparison failed', { error: error.message });
            throw new Error('Unable to compare strategies. Please try again.');
        }
    }

    /**
     * Explain a DeFi concept in simple terms
     * 
     * @param {string} concept - DeFi term or concept to explain
     * @param {string} context - Optional context for better explanation
     * @returns {Promise<string>} Simple explanation
     */
    async explainConcept(concept, context = '') {
        if (!this.groq) {
            this.logger.warn('Groq client not initialized for explainConcept');
            throw new Error('AI explanation service is currently unavailable. Please try again later.');
        }

        const maxRetries = 3;
        const baseDelay = 2000;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.info('Groq API attempt for concept explanation', {
                    attempt,
                    maxRetries,
                    concept
                });

                const prompt = `Explain "${concept}" in simple terms for someone new to DeFi.
            
${context ? `Context: ${context}` : ''}

Requirements:
- Use simple language and clear explanations
- Provide practical real-world analogies where helpful
- Mention important risks and considerations
- Include actionable insights when relevant
- Keep it concise but comprehensive (under 400 words)
- Format for Telegram (simple text, bullet points OK)
- Be professional yet accessible`;

                const response = await this.groq.chat.completions.create({
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an expert DeFi educator with extensive knowledge of cryptocurrency and decentralized finance. Explain complex concepts in simple, clear terms that anyone can understand. Always provide accurate, up-to-date information with appropriate warnings about risks.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    model: this.models.balanced,
                    temperature: 0.6,
                    max_tokens: 1000
                });

                const result = response.choices[0]?.message?.content;
                if (result) {
                    this.logger.info('Concept explanation completed', {
                        concept,
                        responseLength: result.length
                    });
                    return result;
                }
                throw new Error('No response from Groq API');

            } catch (error) {
                lastError = error;
                
                // Enhanced error classification
                const isConnectionError = error.message?.includes('timeout') || 
                                        error.message?.includes('network') ||
                                        error.message?.includes('ENOTFOUND') ||
                                        error.message?.includes('ECONNREFUSED') ||
                                        error.message?.includes('Connection error') ||
                                        error.message?.includes('ETIMEDOUT') ||
                                        error.message?.includes('socket hang up') ||
                                        error.code === 'ECONNREFUSED' ||
                                        error.code === 'ENOTFOUND' ||
                                        error.code === 'ETIMEDOUT';

                const isAuthError = error.message?.includes('401') || 
                                  error.message?.includes('unauthorized') ||
                                  error.message?.includes('invalid api key') ||
                                  error.message?.includes('authentication');

                this.logger.error(`Groq concept explanation attempt ${attempt}/${maxRetries} failed:`, {
                    attempt,
                    error: error.message,
                    errorCode: error.code,
                    isConnectionError,
                    isAuthError,
                    maxRetries,
                    concept
                });

                // Don't retry auth errors
                if (isAuthError) {
                    this.logger.error('Authentication error - check GROQ_API_KEY', {
                        error: error.message,
                        suggestion: 'Verify GROQ_API_KEY is correct in environment variables'
                    });
                    break;
                }

                if (attempt === maxRetries) {
                    break;
                }

                const baseDelay = isConnectionError ? 3000 : 2000;
                const delay = baseDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // All retries failed - throw error instead of fallback
        this.logger.error('All Groq concept explanation attempts failed', { 
            error: lastError?.message || 'Unknown error',
            totalAttempts: maxRetries,
            concept
        });

        throw new Error(`Unable to explain "${concept}" at this time. Please check your connection and try again later.`);
    }

    /**
     * Build a comprehensive prompt for portfolio analysis
     * 
     * @private
     */
    _buildPortfolioPrompt(userQuestion, portfolioData, strategiesData) {
        return `
USER'S QUESTION: "${userQuestion}"

PORTFOLIO DATA:
${JSON.stringify(portfolioData, null, 2)}

AI-GENERATED STRATEGIES:
${JSON.stringify(strategiesData, null, 2)}

INSTRUCTIONS:
Based on the portfolio and strategy data above, answer the user's question.
- Use actual numbers from the data
- Be specific and actionable
- Format for Telegram (simple, clear)
- If the data doesn't contain the answer, say so honestly
- Keep response under 3500 characters
`;
    }

    /**
     * Health check for Groq API
     * 
     * @returns {Promise<boolean>} True if API is accessible
     */
    async healthCheck() {
        if (!this.groq) {
            this.logger.error('Groq health check failed: client not initialized');
            return false;
        }

        try {
            this.logger.info('Starting Groq health check...');
            
            const response = await this.groq.chat.completions.create({
                messages: [
                    { role: 'user', content: 'Hello' }
                ],
                model: this.models.fast,
                max_tokens: 10
            });

            const isHealthy = !!response.choices[0]?.message?.content;
            
            this.logger.info('Groq health check completed', {
                isHealthy,
                hasResponse: !!response,
                hasChoices: !!response.choices,
                choicesLength: response.choices?.length,
                model: this.models.fast
            });

            return isHealthy;
        } catch (error) {
            this.logger.error('Groq health check failed', { 
                error: error.message,
                errorCode: error.code,
                stack: error.stack?.split('\n')[0],
                suggestion: error.message?.includes('401') ? 
                    'Check GROQ_API_KEY in Railway environment variables' :
                    error.message?.includes('timeout') ?
                    'Network connectivity issue - check Railway network' :
                    'Unknown error - check Groq service status'
            });
            return false;
        }
    }
}

module.exports = GroqAnalyzer;
