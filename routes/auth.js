const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const SECRET_QUESTIONS = [
    "What was the name of your first pet?",
    "What is your mother's maiden name?",
    "What was the name of your elementary school?",
    "What city were you born in?",
    "What is your oldest sibling's middle name?",
    "What was the make of your first car?",
    "What is the name of the street you grew up on?"
];

// Register
router.post('/register', async (req, res) => {
    try {
        const { name, idNumber, birthdate, password, isGraduate, isProfessor, secretQuestion, secretAnswer } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ idNumber });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create user
        const user = new User({
            name,
            idNumber,
            birthdate: birthdate || null,
            password,
            isGraduate: isGraduate || false,
            isProfessor: isProfessor || false,
            secretQuestion: secretQuestion || null,
            secretAnswer: secretAnswer || null
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
                isGraduate: user.isGraduate,
                isProfessor: user.isProfessor,
                profilePhoto: user.profilePhoto,
                secretQuestion: user.secretQuestion
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
            return res.status(400).json({ message: 'Invalid credentials' });
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
                isGraduate: user.isGraduate,
                isProfessor: user.isProfessor,
                profilePhoto: user.profilePhoto,
                secretQuestion: user.secretQuestion
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
                isGraduate: user.isGraduate,
                isProfessor: user.isProfessor,
                profilePhoto: user.profilePhoto
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error logging in as admin', error: error.message });
    }
});

// Forgot Password — supports both birthdate and secret question verification
router.post('/forgot-password', async (req, res) => {
    try {
        const { idNumber, newPassword, verificationMethod, birthdate, secretAnswer } = req.body;

        if (!idNumber || !newPassword || !verificationMethod) {
            return res.status(400).json({ message: 'ID Number, new password, and verification method are required' });
        }

        // Find user
        const user = await User.findOne({ idNumber });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        if (verificationMethod === 'birthdate') {
            if (!birthdate) {
                return res.status(400).json({ message: 'Birthdate is required for this verification method' });
            }
            if (!user.birthdate) {
                return res.status(400).json({ message: 'No birthdate registered on this account. Try using your secret question instead.' });
            }
            const storedDate = new Date(user.birthdate).toISOString().split('T')[0];
            const providedDate = new Date(birthdate).toISOString().split('T')[0];
            if (storedDate !== providedDate) {
                return res.status(400).json({ message: 'Birthdate does not match our records' });
            }

        } else if (verificationMethod === 'secretQuestion') {
            if (!secretAnswer) {
                return res.status(400).json({ message: 'Secret answer is required for this verification method' });
            }
            if (!user.secretQuestion || !user.secretAnswer) {
                return res.status(400).json({ message: 'No secret question registered on this account. Try using your birthdate instead.' });
            }
            const isMatch = await user.compareSecretAnswer(secretAnswer);
            if (!isMatch) {
                return res.status(400).json({ message: 'Secret answer does not match our records' });
            }

        } else {
            return res.status(400).json({ message: 'Invalid verification method. Use "birthdate" or "secretQuestion".' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }

        // Update password (pre-save hook will hash it)
        user.password = newPassword;
        await user.save();

        res.json({ message: 'Password reset successful' });

    } catch (error) {
        res.status(500).json({ message: 'Error resetting password', error: error.message });
    }
});

// Get available secret questions list
router.get('/secret-questions', (req, res) => {
    res.json({ questions: SECRET_QUESTIONS });
});

// Logout
router.post('/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;