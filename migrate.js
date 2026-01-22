#!/usr/bin/env node


require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.NODE_ENV === 'production' ? './aura_bot.db' : './aura_bot_dev.db';

console.log('Starting database migration...');
console.log(`Database: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database');
});

// Migration functions
const migrations = [
  {
    version: 1,
    name: 'Create core tables',
    up: () => new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id INTEGER UNIQUE NOT NULL,
          username TEXT,
          wallet_address TEXT,
          risk_tolerance TEXT DEFAULT 'medium',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_active DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, err => { if (err) reject(err); });

        db.run(`CREATE TABLE IF NOT EXISTS api_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cache_key TEXT UNIQUE NOT NULL,
          cache_data TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, err => { if (err) reject(err); else resolve(); });
      });
    })
  },
  {
    version: 2,
    name: 'Add indexes',
    up: () => new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id)`, err => { if (err) reject(err); });
        db.run(`CREATE INDEX IF NOT EXISTS idx_api_cache_key ON api_cache (cache_key)`, err => { if (err) reject(err); });
        db.run(`CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache (expires_at)`, err => { if (err) reject(err); else resolve(); });
      });
    })
  }
];

// Check which migrations have been applied
function getAppliedMigrations() {
    return new Promise((resolve, reject) => {
        // First ensure migrations table exists
        db.run(`CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version INTEGER UNIQUE NOT NULL,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                reject(err);
                return;
            }
            
            // Now get applied migrations
            db.all('SELECT version FROM migrations ORDER BY version', (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows.map(row => row.version));
                }
            });
        });
    });
}

// Record migration as applied
function recordMigration(version, name) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO migrations (version, name) VALUES (?, ?)',
            [version, name],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

// Run migrations
async function runMigrations() {
    try {
        const appliedMigrations = await getAppliedMigrations();
    console.log(`Applied migrations: [${appliedMigrations.join(', ')}]`);

        for (const migration of migrations) {
            if (!appliedMigrations.includes(migration.version)) {
                console.log(`Running migration ${migration.version}: ${migration.name}`);
                
                await migration.up();
                await recordMigration(migration.version, migration.name);
                
                console.log(`Migration ${migration.version} completed`);
            } else {
                console.log(`Migration ${migration.version} already applied`);
            }
        }

    console.log('All migrations completed successfully!');
        
        // Show database stats
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (!err) {
                console.log(`Total users: ${row.count}`);
            }
        });

        db.get('SELECT COUNT(*) as count FROM api_cache', (err, row) => {
            if (!err) {
                console.log(`Cache entries: ${row.count}`);
            }
        });

    } catch (error) {
    console.error('Migration failed:', error.message);
        process.exit(1);
    }
}

// Clean up expired cache entries
function cleanupCache() {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        db.run('DELETE FROM api_cache WHERE CAST(expires_at AS INTEGER) < ?', [now], err => {
            if (err) {
                reject(err);
            } else {
                console.log('Cleaned up expired cache entries');
                resolve();
            }
        });
    }).finally(() => {
        // Close the database after cleanup when running migrations as a one-off task
        db.close(err => {
            if (err) console.error('Error closing database:', err.message);
            else console.log('Database connection closed');
        });
    });
}

// Main execution
async function main() {
    await runMigrations();
    await cleanupCache();
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runMigrations, cleanupCache };
