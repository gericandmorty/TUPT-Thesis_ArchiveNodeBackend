require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const connectionString = process.env.MONGODB_URI || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_CLUSTER}/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

        const conn = await mongoose.connect(connectionString);

        console.log(`✅ MongoDB Connected Successfully`);
        console.log(`📊 Database: ${conn.connection.name}`);
        console.log(`🎯 Host: ${conn.connection.host}`);
        
        // Migrate existing users to isApproved: true if not set
        try {
            const User = require('../models/User');
            const result = await User.updateMany(
                { isApproved: { $exists: false } },
                { $set: { isApproved: true } }
            );
            if (result.modifiedCount > 0) {
                console.log(`Migrated ${result.modifiedCount} existing users to isApproved: true`);
            }
        } catch (migrationError) {
            console.error('⚠️ Database migration failed:', migrationError.message);
        }
        
        return conn;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;