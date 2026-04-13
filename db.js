const mongoose = require('mongoose');

let isConnected = false;
const targetDbName = process.env.MONGODB_DB_NAME || 'debate-app';

const connectDB = async () => {
  if (isConnected) {
    console.log('✅ MongoDB already connected');
    return;
  }

  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoUri, {
      dbName: targetDbName
    });

    isConnected = true;
    console.log('✅ MongoDB Connected Successfully!');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`📦 Target Collection: usersData`);
    
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    isConnected = false;
    // Don't throw - allow app to run in fallback mode
  }
};

const getDBStatus = () => ({
  connected: isConnected,
  dbName: targetDbName,
  uri: process.env.MONGODB_URI ? '***hidden***' : 'Not configured'
});

module.exports = {
  connectDB,
  getDBStatus,
  mongoose
};
