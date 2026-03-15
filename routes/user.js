const express = require('express');
const User = require('../models/User');
const Thesis = require('../models/Thesis');
const AiHistory = require('../models/AiHistory');
const router = express.Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const { analyzeDocument } = require('../modules/documentAnalyzer');

// Multer configuration for file analysis (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// @route   POST /user/theses
// @desc    Submit a new thesis
router.post('/theses', auth, async (req, res) => {
    try {
        const { title, abstract, author, year_range, category, id } = req.body;

        const newThesis = new Thesis({
            id: id || `USER-${Date.now()}`, // Fallback ID if not provided
            title,
            abstract,
            author,
            year_range,
            category,
            createdBy: req.user,
            isApproved: false // Always false by default for user submissions
        });

        const thesis = await newThesis.save();
        res.status(201).json({ success: true, data: thesis });
    } catch (err) {
        console.error('Submission error:', err);
        res.status(500).json({ success: false, message: 'Error submitting thesis', error: err.message });
    }
});

// @route   GET /user/theses
// @desc    Get all theses created by the logged-in user
router.get('/theses', auth, async (req, res) => {
    try {
        const theses = await Thesis.find({ createdBy: req.user }).sort({ createdAt: -1 });
        res.json({ success: true, data: theses });
    } catch (err) {
        console.error('Fetch error:', err);
        res.status(500).json({ success: false, message: 'Error fetching your theses', error: err.message });
    }
});


router.get('/profile', auth, async (req, res) => {
    try {

        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                user: user
            }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user profile',
            error: error.message
        });
    }
});


router.put('/profile', auth, async (req, res) => {
    try {
        const { userId, name, birthdate, currentPassword, newPassword } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Update name if provided
        if (name) {
            user.name = name;
        }

        // Update birthdate if provided
        if (birthdate) {
            const newBirthdate = new Date(birthdate);
            if (newBirthdate > new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'Birthdate cannot be in the future'
                });
            }
            user.birthdate = newBirthdate;
        }

        // Update password if provided
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is required to set new password'
                });
            }

            // Verify current password
            const isCurrentPasswordValid = await user.comparePassword(currentPassword);
            if (!isCurrentPasswordValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }

            // Check if new password meets requirements
            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 6 characters long'
                });
            }

            user.password = newPassword;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: user
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'User with this ID number already exists'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: error.message
        });
    }
});

// @route   POST /user/analyze
// @desc    Analyze a research document
router.post('/analyze', auth, upload.single('thesis'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const stats = await analyzeDocument(req.file.buffer, req.file.mimetype);

        res.json({
            success: true,
            ...stats
        });

    } catch (err) {
        console.error('Analysis error:', err);
        res.status(500).json({
            success: false,
            message: 'Error analyzing document',
            error: err.message
        });
    }
});

// @route   GET /user/ai-history
// @desc    Get all AI prompt history for the logged-in user
router.get('/ai-history', auth, async (req, res) => {
    try {
        const history = await AiHistory.find({ user: req.user }).sort({ createdAt: -1 });
        res.json({ success: true, data: history });
    } catch (err) {
        console.error('Fetch AI history error:', err);
        res.status(500).json({ success: false, message: 'Error fetching AI history', error: err.message });
    }
});

// @route   DELETE /user/ai-history/:id
// @desc    Delete a specific AI prompt history
router.delete('/ai-history/:id', auth, async (req, res) => {
    try {
        const history = await AiHistory.findOne({ _id: req.params.id, user: req.user });

        if (!history) {
            return res.status(404).json({ success: false, message: 'History record not found or unauthorized' });
        }

        await history.deleteOne();
        res.json({ success: true, message: 'History record deleted' });
    } catch (err) {
        console.error('Delete AI history error:', err);
        res.status(500).json({ success: false, message: 'Error deleting AI history', error: err.message });
    }
});

// @route   DELETE /user/ai-history
// @desc    Clear all AI prompt history for the user
router.delete('/ai-history', auth, async (req, res) => {
    try {
        await AiHistory.deleteMany({ user: req.user });
        res.json({ success: true, message: 'All history records deleted' });
    } catch (err) {
        console.error('Clear AI history error:', err);
        res.status(500).json({ success: false, message: 'Error clearing AI history', error: err.message });
    }
});

// @route   POST /user/ai-history
// @desc    Save a new AI prompt/recommendation
router.post('/ai-history', auth, async (req, res) => {
    try {
        const { prompt, recommendation } = req.body;

        if (!prompt || !recommendation) {
            return res.status(400).json({ success: false, message: 'Prompt and recommendation required' });
        }

        const newHistory = new AiHistory({
            user: req.user,
            prompt,
            recommendation
        });

        await newHistory.save();
        res.status(201).json({ success: true, data: newHistory });
    } catch (err) {
        console.error('Save AI history error:', err);
        res.status(500).json({ success: false, message: 'Error saving AI history', error: err.message });
    }
});

module.exports = router;