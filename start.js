#!/usr/bin/env node
/**
 * Railway Production Bot Launcher
 * Simplified version with better Railway environment detection
 */

require('dotenv').config();

async function startRailwayBot() {
    console.log('Starting AURA Bot for Railway...');
    
    // Check Railway environment variables
    const isRailway = !!(
        process.env.RAILWAY_ENVIRONMENT || 
        process.env.RAILWAY_PROJECT_ID || 
        process.env.RAILWAY_SERVICE_ID ||
        process.env.NODE_ENV === 'production'
    );
    
    console.log('Environment check:', {
        isRailway: isRailway,
        railwayEnv: process.env.RAILWAY_ENVIRONMENT,
        railwayProjectId: !!process.env.RAILWAY_PROJECT_ID,
        railwayServiceId: !!process.env.RAILWAY_SERVICE_ID,
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT
    });
    
    if (isRailway) {
    console.log('Railway production environment detected');
        
        // Try to use webhook if Railway provides public domain
        const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
        
        if (railwayDomain) {
            console.log('Setting up webhook mode...');
            process.env.USE_WEBHOOK = 'true';
            process.env.WEBHOOK_URL = `https://${railwayDomain}`;
            process.env.WEBHOOK_PORT = process.env.PORT || '3000';
            console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
        } else {
            console.log('No Railway public domain found, using polling mode');
            console.log('Available Railway env vars:', Object.keys(process.env).filter(k => k.startsWith('RAILWAY_')));
        }
        
        // Set production optimizations
        process.env.NODE_ENV = 'production';
        
    } else {
    console.log('Local development mode detected');
    }
    
    // Add error handling
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection:', reason);
        console.error('Promise:', promise);
    });
    
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        process.exit(1);
    });
    
    // Run migrations before starting (idempotent)
    try {
        console.log('Running migrations before launch...');
        const { runMigrations, cleanupCache } = require('./migrate');
        await runMigrations();
        // Cleanup expired cache entries (ignore errors, non-critical)
        try { await cleanupCache(); } catch (e) { console.warn('Cache cleanup failed (continuing):', e.message); }
    } catch (err) {
        console.warn('Migration phase encountered an issue (continuing):', err.message);
    }

    // Start the bot
    console.log('Launching bot...');
    try {
        require('./bot.js');
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

startRailwayBot();
