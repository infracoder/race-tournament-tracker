#!/usr/bin/env node

require('dotenv').config();
const { initializeSchema, seedTournament } = require('../database');

async function resetDatabase() {
  console.log('🔄 Resetting tournament database...\n');
  
  try {
    await initializeSchema();
    await seedTournament();
    
    console.log('\n✅ Database reset complete!');
    console.log('📋 Tournament is now ready for player registration.\n');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase();
