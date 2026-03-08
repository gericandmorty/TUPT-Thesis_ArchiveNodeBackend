require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Import CORS
const connectDB = require('./db/connection');

const app = express();
const PORT = process.env.PORT;

// Connect to DB
connectDB();

// Middleware
const allowedOrigins = ['http://localhost:3000', 'https://tupt-thesis-archive.vercel.app'];
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));
app.use(express.json());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/user', require('./routes/user'));
app.use('/thesis', require('./routes/thesis'));
app.use('/admin', require('./routes/admin'));

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});