const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Register
router.post('/register', async (req, res) => {
    try {
        const { name, idNumber, birthdate, password } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ idNumber });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create user
        const user = new User({
            name,
            idNumber,
            birthdate,
            password
        });

        await user.save();

        // Create Token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: {
                _id: user._id,
                name: user.name,
                idNumber: user.idNumber,
                birthdate: user.birthdate,
                isAdmin: user.isAdmin,
                profilePhoto: user.profilePhoto
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { idNumber, password } = req.body;

        // Find user
        const user = await User.findOne({ idNumber });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        // Create Token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

        res.json({
            message: 'Login successful',
            token,
            user: {
                _id: user._id,
                name: user.name,
                idNumber: user.idNumber,
                birthdate: user.birthdate,
                isAdmin: user.isAdmin,
                profilePhoto: user.profilePhoto
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error: error.message });
    }
});

// Admin Login
router.post('/admin/login', async (req, res) => {
    try {
        const { idNumber, password } = req.body;

        // Find user
        const user = await User.findOne({ idNumber });
        if (!user) {
            return res.status(400).json({ message: 'Admin not found' });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Check if Admin
        if (!user.isAdmin) {
            return res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
        }

        // Create Token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

        res.json({
            message: 'Admin login successful',
            token,
            user: {
                _id: user._id,
                name: user.name,
                idNumber: user.idNumber,
                birthdate: user.birthdate,
                isAdmin: user.isAdmin,
                profilePhoto: user.profilePhoto
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error logging in as admin', error: error.message });
    }
});

// Forgot Password (Reset using Birthdate)
router.post('/forgot-password', async (req, res) => {
    try {
        const { idNumber, birthdate, newPassword } = req.body;

        if (!idNumber || !birthdate || !newPassword) {
            return res.status(400).json({ message: 'ID Number, birthdate, and new password are required' });
        }

        // Find user
        const user = await User.findOne({ idNumber });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        // Verify birthdate (Compare date part only)
        const storedDate = new Date(user.birthdate).toISOString().split('T')[0];
        const providedDate = new Date(birthdate).toISOString().split('T')[0];

        if (storedDate !== providedDate) {
            return res.status(400).json({ message: 'Invalid birthdate verification' });
        }

        // Update password (pre-save hook will hash it)
        user.password = newPassword;
        await user.save();

        res.json({ message: 'Password reset successful' });

    } catch (error) {
        res.status(500).json({ message: 'Error resetting password', error: error.message });
    }
});

module.exports = router;