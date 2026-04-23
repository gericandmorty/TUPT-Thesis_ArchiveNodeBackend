const express = require('express');
const router = express.Router();

// @route   GET /uptime/ping
// @desc    Health check endpoint for uptime monitor bots
// @access  Public
router.get('/ping', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

module.exports = router;
