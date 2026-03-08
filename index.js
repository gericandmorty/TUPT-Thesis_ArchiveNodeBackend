require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Import CORS
const connectDB = require('./db/connection');

const app = express();
const PORT = process.env.PORT;

// Connect to DB
connectDB();

// Middleware
app.use(cors()); // Enable CORS for all origins
app.use(express.json());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/user', require('./routes/user'));
app.use('/thesis', require('./routes/thesis'));

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});